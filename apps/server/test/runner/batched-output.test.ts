import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import type { UIMessageChunk } from "ai";
import { createBatchedOutput } from "@tabdo/agent-runtime/batched-output";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve,ms));
test("buffer preserves reasoning, boundaries and finish without charging each token a network RTT", async () => {
  const received: UIMessageChunk[] = [];
  let requests = 0;
  const server = createServer(async(request,response) => {
    let input = "";for await (const chunk of request) input += chunk;
    received.push(...JSON.parse(input).chunks);requests++;
    await sleep(20);response.end("ok");
  });
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  const address = server.address();assert(address && typeof address === "object");
  const send = async(chunks: readonly UIMessageChunk[]) => {
    const response = await fetch(`http://127.0.0.1:${address.port}`,{method:"POST",body:JSON.stringify({chunks})});
    assert(response.ok);await response.body?.cancel();
  };
  const chunks: UIMessageChunk[] = [
    {type:"start",messageId:"message"},{type:"reasoning-start",id:"thought"},
    ...Array.from({length:40},(_,i): UIMessageChunk => ({type:"reasoning-delta",id:"thought",delta:`r${i};`})),
    {type:"reasoning-end",id:"thought"},{type:"text-start",id:"answer"},
    ...Array.from({length:80},(_,i): UIMessageChunk => ({type:"text-delta",id:"answer",delta:`t${i};`})),
    {type:"text-end",id:"answer"},{type:"finish"},
  ];
  const contents = (parts: readonly UIMessageChunk[],type: "text-delta"|"reasoning-delta") => parts.flatMap(part => part.type === type ? [part.delta] : []).join("");
  try {
    const oldStart = performance.now();
    for (const chunk of chunks) await send([chunk]);
    const oldMs = performance.now()-oldStart, oldRequests = requests;
    received.length = 0;requests = 0;
    const output = createBatchedOutput({writeBatch:send});
    const start = performance.now();
    for (const chunk of chunks) await output.write(chunk);
    await output.flush();
    const batchedMs = performance.now()-start;
    assert.equal(contents(received,"reasoning-delta"),contents(chunks,"reasoning-delta"));
    assert.equal(contents(received,"text-delta"),contents(chunks,"text-delta"));
    assert.deepEqual(received.filter(part => !["text-delta","reasoning-delta"].includes(part.type)),chunks.filter(part => !["text-delta","reasoning-delta"].includes(part.type)));
    assert.equal(requests,1);assert.equal(oldRequests,chunks.length);
    assert(batchedMs < oldMs/3,`serial ${oldMs}ms vs batched ${batchedMs}ms`);
    console.info(`Controlled HTTP transport (20ms RTT fixture): serial ${Math.round(oldMs)}ms/${oldRequests} requests; buffered ${Math.round(batchedMs)}ms/${requests} request`);
  } finally { server.closeAllConnections();await new Promise<void>(resolve => server.close(()=>resolve())); }
});

test("streaming writes publish before finish and flush waits for durable completion", async () => {
  let started = false,complete = false,release!: () => void;
  const output = createBatchedOutput({flushIntervalMs:5,writeBatch:async () => {
    started = true;await new Promise<void>(resolve => {release=resolve;});complete = true;
  }});
  await output.write({type:"reasoning-delta",id:"thought",delta:"live"});
  for (let i=0;i<100 && !started;i++) await sleep(5);
  assert(started,"partial reasoning must publish before the producer finishes");
  let flushed = false;
  const barrier = output.flush().then(()=>{flushed=true;});
  await sleep(5);assert(!flushed);release();await barrier;assert(complete);
});

test("ambiguous append failure is sticky and never automatically retried", async () => {
  const error = new Error("lost append acknowledgement");let attempts = 0;
  const output = createBatchedOutput({writeBatch:async()=>{attempts++;throw error;}});
  await output.write({type:"text-delta",id:"answer",delta:"once"});
  await assert.rejects(output.flush(),value=>value===error);
  await assert.rejects(output.write({type:"text-delta",id:"answer",delta:"again"}),value=>value===error);
  await assert.rejects(output.flush(),value=>value===error);
  assert.equal(attempts,1);
});

test("bounded pending output applies backpressure while keeping chunk boundaries", async () => {
  const releases: (()=>void)[] = [],received: UIMessageChunk[] = [];
  const output = createBatchedOutput({maxBatchBytes:1024,maxPendingBytes:2048,maxBatchChunks:1,writeBatch:async chunks=>{
    received.push(...chunks);await new Promise<void>(resolve=>releases.push(resolve));
  }});
  const chunk = (id:string): UIMessageChunk=>({type:"text-delta",id,delta:"x".repeat(900)});
  await output.write(chunk("a"));await output.write(chunk("b"));
  let accepted = false;
  const third = output.write(chunk("c")).then(()=>{accepted=true;});
  await sleep(5);assert(!accepted);assert.equal(received.length,1);
  releases.shift()!();await third;
  const barrier = output.flush();
  for (let i=0;i<100 && received.length<3;i++) { releases.shift()?.();await sleep(2); }
  releases.shift()?.();await barrier;
  assert.deepEqual(received.map(part=>part.type==="text-delta"?part.id:""),["a","b","c"]);
});
