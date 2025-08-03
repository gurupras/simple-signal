import SimplePeer from "simple-peer"

export const ERR_CONNECTION_TIMEOUT = 'ERR_CONNECTION_TIMEOUT';
export const ERR_PREMATURE_CLOSE = 'ERR_PREMATURE_CLOSE';

// A minimal interface for the socket object, assuming a socket.io-like API.
export interface Socket {
  on(event: string, listener: (...args: any[]) => void): this;
  emit(event: string, ...args: any[]): this;
  close(): void;
  readonly id?: string;
}

export interface SimpleSignalOptions {
  connectionTimeout?: number;
}

export interface RequestData {
  initiator: string;
  metadata: any;
  sessionId: string;
}

export interface Request extends RequestData {
  accept: (metadata?: any, peerOptions?: SimplePeer.Options) => Promise<{ peer: SimplePeer.Instance; metadata: any }>;
  reject: (metadata?: any) => void;
}

// Define the events that the client can emit
export type Events = {
  discover: any
  request: Request
};

// Extend simple-peer's Instance type to include custom methods we add.
export interface CustomPeer extends SimplePeer.Instance {
  resolveMetadata?: ((metadata: any) => void) | null;
  reject?: (metadata: any) => void;
}

export type TranceiverRequestData = {
  type: "transceiverRequest";
  transceiverRequest: {
    kind: string;
    init?: RTCRtpTransceiverInit | undefined;
  }
}

export type RenegotiateData = {
    type: "renegotiate";
    renegotiate: true;
}

export type CandidateData = {
    type: "candidate";
    candidate: RTCIceCandidate;
}
export type SignalData =
    | TranceiverRequestData
    | RenegotiateData
    | CandidateData
    | RTCSessionDescriptionInit;
