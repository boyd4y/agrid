import { createUIMessageStream } from "ai";
import { chatErrorText } from "../ai/errors.js";
import { executeNativeRun, type NativeRunInput } from "./execution.js";

/** HTTP projection only. Reader cancellation detaches delivery, not the accepted Run. */
export function createNativeChatStream(options: NativeRunInput) {
  return createUIMessageStream({
    onError: chatErrorText,
    execute: ({ writer }) => executeNativeRun(options, writer),
  });
}
