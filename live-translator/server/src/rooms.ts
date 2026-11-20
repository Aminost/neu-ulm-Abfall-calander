import type { WebSocket } from "ws";
import { randomInt, randomUUID } from "node:crypto";

/**
 * Multi-phone sessions: every participant uses their own phone + headset.
 * The speaker's phone transcribes and sends the original text; each listener's
 * phone translates into its own language and plays it on its own headset.
 * The server only relays messages inside a room.
 */
export interface Member {
  id: string;
  name: string;
  language: string;
  socket: WebSocket;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class Rooms {
  private rooms = new Map<string, Map<string, Member>>();

  newCode(): string {
    for (;;) {
      let code = "";
      for (let i = 0; i < 6; i++) code += ALPHABET[randomInt(ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  join(code: string, name: string, language: string, socket: WebSocket): Member {
    const room = this.rooms.get(code) ?? new Map<string, Member>();
    this.rooms.set(code, room);
    if (room.size >= 8) throw new Error("room is full");
    const member: Member = { id: randomUUID(), name: name.slice(0, 40) || "Guest", language, socket };
    room.set(member.id, member);
    this.broadcastMembers(code);
    return member;
  }

  leave(code: string, memberId: string) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.delete(memberId);
    if (room.size === 0) this.rooms.delete(code);
    else this.broadcastMembers(code);
  }

  relay(code: string, from: Member, payload: Record<string, unknown>) {
    const room = this.rooms.get(code);
    if (!room) return;
    const msg = JSON.stringify({ ...payload, from: { id: from.id, name: from.name, language: from.language } });
    for (const m of room.values()) if (m.id !== from.id && m.socket.readyState === 1) m.socket.send(msg);
  }

  private broadcastMembers(code: string) {
    const room = this.rooms.get(code);
    if (!room) return;
    const members = [...room.values()].map((m) => ({ id: m.id, name: m.name, language: m.language }));
    const msg = JSON.stringify({ type: "members", code, members });
    for (const m of room.values()) if (m.socket.readyState === 1) m.socket.send(msg);
  }
}

export const messageId = () => randomUUID();
