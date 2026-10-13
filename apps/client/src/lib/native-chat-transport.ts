import type { HttpChatTransportInitOptions, UIMessage } from "ai";

/** Native session history stays on the server; the UI history remains intact. */
export const prepareNativeChatRequest: NonNullable<HttpChatTransportInitOptions<UIMessage>["prepareSendMessagesRequest"]> = ({ id, messages, body, trigger, messageId, requestMetadata }) => {
  const latestUser = [...messages].reverse().find(message => message.role === "user");
  return { body: { ...body, id, messages: latestUser ? [latestUser] : [], trigger, messageId, metadata: requestMetadata } };
};
