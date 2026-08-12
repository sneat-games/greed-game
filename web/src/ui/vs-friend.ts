// vs Friend: hosts a private room (reserve a code, share a link) or joins an
// existing one as the guest, then agrees the match shape over the wire before
// handing off to the round loop in friend-match.ts.
//
// The HOST came through the menu; the GUEST arrives straight off a `#room=`
// link (see main.ts) and has never seen it, so the guest learns the match's
// shape only from the host's `hello` (game-kit/docs/DESIGN.md's PvP protocol
// v1). The Greed Game has one variant today, so `hello` carries
// `{ mode: "classic", rounds, bankroll }` — the guest still checks it rather
// than assuming, so a future variant or a different match length is a clean
// refusal instead of two clients silently playing different games.

import {
  reserveRoomId,
  hostPeer,
  guestPeer,
  shareLinkFor,
  updateRoom,
  inviteLink,
  leftRoom,
  type PeerHandle,
  type WireMessage,
} from "@sneat/game-kit";
import { MATCH_ROUNDS, START_BANKROLL } from "../engine/greedplay";
import { runFriendMatch } from "./friend-match";

/** Namespaces rooms on the shared relay. Unrelated to the game's domain
 *  (greed.sneat.games) — this is the protocol id, and it stays `greed-game`. */
const GAME_ID = "greed-game";
const PROTOCOL = 1;
const HELLO_TIMEOUT_MS = 20_000;

/** The one config shape this build speaks. */
const MATCH_CONFIG = { mode: "classic", rounds: MATCH_ROUNDS, bankroll: START_BANKROLL } as const;

export type VsFriendOptions = { as: "host" } | { as: "guest"; roomId: string };

export async function runVsFriend(root: HTMLElement, opts: VsFriendOptions): Promise<void> {
  let peer: PeerHandle | null = null;
  try {
    if (opts.as === "host") {
      const roomId = await reserveRoomId({ gameId: GAME_ID });
      updateRoom({ roomId, isJoinable: true, inviteParams: { roomId } });
      // Rendered BEFORE awaiting hostPeer, which blocks until the guest's
      // DataChannel opens — await first and the host stares at a blank
      // screen with no code to share (playbook gotcha 5).
      renderInvite(root, {
        roomId,
        shareLink: shareLinkFor(shareBaseUrl(), roomId),
        cgShareLink: inviteLink({ roomId }),
      });

      peer = await hostPeer({ gameId: GAME_ID, roomId });
      peer.send({ kind: "hello", game: GAME_ID, protocol: PROTOCOL, config: MATCH_CONFIG });
      if (!(await waitForHelloAck(peer))) {
        await renderRefused(root, "Your friend's app could not join this match.");
        return;
      }
      await runFriendMatch(root, peer);
    } else {
      updateRoom({ roomId: opts.roomId, isJoinable: true, inviteParams: { roomId: opts.roomId } });
      renderJoined(root, opts.roomId);

      peer = await guestPeer({ gameId: GAME_ID, roomId: opts.roomId });
      if (!(await waitForHello(peer))) {
        await renderRefused(root, "Could not agree the match settings with your friend.");
        return;
      }
      peer.send({ kind: "hello-ack" });
      await runFriendMatch(root, peer);
    }
  } catch (e) {
    await renderRefused(root, e instanceof Error ? e.message : "Connection failed.");
  } finally {
    peer?.close();
    leftRoom();
  }
}

/** The invite link's base URL. Off `*.sneat.games` (CrazyGames, itch.io —
 *  see docs/DESIGN.md's "Distribution" section) the host's own origin isn't
 *  a working link for anyone else, so this falls back to the game's
 *  canonical subdomain instead. */
function shareBaseUrl(): string {
  const { hostname, origin, pathname } = window.location;
  if (hostname.endsWith(".sneat.games") || hostname === "localhost" || hostname.startsWith("127.")) {
    return `${origin}${pathname}`;
  }
  return "https://greed.sneat.games/";
}

function waitForHello(peer: PeerHandle): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => finish(false), HELLO_TIMEOUT_MS);
    function onMessage(msg: WireMessage) {
      if (msg.kind !== "hello" || msg.game !== GAME_ID || msg.protocol !== PROTOCOL) return;
      const config = msg.config as { mode?: unknown; rounds?: unknown; bankroll?: unknown };
      finish(
        config.mode === MATCH_CONFIG.mode &&
          config.rounds === MATCH_CONFIG.rounds &&
          config.bankroll === MATCH_CONFIG.bankroll,
      );
    }
    function finish(v: boolean) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      peer.offMessage(onMessage);
      resolve(v);
    }
    peer.onMessage(onMessage);
  });
}

function waitForHelloAck(peer: PeerHandle): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => finish(false), HELLO_TIMEOUT_MS);
    function onMessage(msg: WireMessage) {
      if (msg.kind === "hello-ack") finish(true);
    }
    function finish(v: boolean) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      peer.offMessage(onMessage);
      resolve(v);
    }
    peer.onMessage(onMessage);
  });
}

function renderInvite(root: HTMLElement, args: { roomId: string; shareLink: string; cgShareLink: string | null }): void {
  root.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "menu";
  wrap.setAttribute("data-invite", "");

  const heading = document.createElement("h2");
  heading.className = "menu__title";
  heading.textContent = `Room ${args.roomId}`;

  const waiting = document.createElement("p");
  waiting.textContent = "Waiting for your friend to join…";

  const link = document.createElement("p");
  link.className = "invite-link";
  link.setAttribute("data-invite-link", "");
  link.textContent = args.shareLink;

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "btn btn--primary";
  copyBtn.textContent = "Copy link";
  copyBtn.addEventListener("click", () => {
    void navigator.clipboard?.writeText(args.shareLink);
    copyBtn.textContent = "Copied";
    setTimeout(() => (copyBtn.textContent = "Copy link"), 1500);
  });

  wrap.append(heading, waiting, link, copyBtn);
  if (args.cgShareLink) {
    const cg = document.createElement("p");
    cg.textContent = `Or invite via CrazyGames: ${args.cgShareLink}`;
    wrap.append(cg);
  }
  root.append(wrap);
}

function renderJoined(root: HTMLElement, roomId: string): void {
  root.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "menu";
  const p = document.createElement("p");
  p.textContent = `Joined room ${roomId}. Connecting…`;
  wrap.append(p);
  root.append(wrap);
}

/**
 * The handshake never completed. Resolves only once the player acknowledges
 * it: main.ts re-renders the menu the moment this session function returns,
 * so returning immediately would wipe the explanation off the screen before
 * it could be read.
 */
function renderRefused(root: HTMLElement, message: string): Promise<void> {
  root.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "menu";
  wrap.setAttribute("data-connect-failed", "");
  const p = document.createElement("p");
  p.className = "error";
  p.textContent = message;
  const back = document.createElement("button");
  back.type = "button";
  back.className = "btn btn--ghost";
  back.textContent = "Back to menu";
  wrap.append(p, back);
  root.append(wrap);
  return new Promise((resolve) => back.addEventListener("click", () => resolve()));
}
