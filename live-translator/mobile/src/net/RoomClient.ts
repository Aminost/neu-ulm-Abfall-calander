export interface RoomMember {
  id: string;
  name: string;
  language: string;
}

export interface RemoteUtterance {
  id?: string;
  text: string;
  language: string;
  from: RoomMember;
}

/** Multi-phone session: relays what each phone heard to the other phones in the room. */
export class RoomClient {
  private ws: WebSocket | null = null;
  private closed = false;
  myId: string | null = null;

  constructor(
    private url: string,
    private on: {
      members: (m: RoomMember[]) => void;
      utterance: (u: RemoteUtterance) => void;
      partial: (from: RoomMember, text: string) => void;
      status: (s: "connecting" | "connected" | "disconnected", reason?: string) => void;
    },
  ) {}

  connect() {
    this.closed = false;
    this.on.status("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === "welcome") {
        this.myId = msg.id;
        this.on.status("connected");
      } else if (msg.type === "members") this.on.members(msg.members);
      else if (msg.type === "utterance") this.on.utterance(msg);
      else if (msg.type === "partial") this.on.partial(msg.from, msg.text);
    };
    ws.onclose = (ev) => {
      this.on.status("disconnected", ev.reason || undefined);
      if (!this.closed && ev.code < 4000) setTimeout(() => !this.closed && this.connect(), 2000);
    };
  }

  sendUtterance(id: string, text: string, language: string) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: "utterance", id, text, language }));
  }

  sendPartial(text: string) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: "partial", text }));
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}
