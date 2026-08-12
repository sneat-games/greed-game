// Standings preview (header trophy button) — see game-kit/docs/DESIGN.md
// §"Leaderboard (design-only; NOT in MVP)": Competios has no standings/
// rating code yet, so this ships as a designed, data-stubbed screen. The
// vs-Bot win/loss/draw record is REAL (kept in localStorage, this browser
// only); the ladder below it is mocked and clearly labelled as such. No
// network call, no wiring to Competios — that is future, game->competios
// work.
//
// Unlike Hex (which has no draws), a Greed Game match CAN be drawn — level
// bankrolls after the final round — so the record has three buckets.

const STORAGE_KEY = "greed-game:standings:vs-bot";

export type VsBotResult = "win" | "loss" | "draw";

interface VsBotRecord {
  wins: number;
  losses: number;
  draws: number;
}

function readRecord(): VsBotRecord {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { wins: 0, losses: 0, draws: 0 };
    const parsed = JSON.parse(raw) as Partial<VsBotRecord>;
    return {
      wins: Number(parsed.wins) || 0,
      losses: Number(parsed.losses) || 0,
      draws: Number(parsed.draws) || 0,
    };
  } catch {
    return { wins: 0, losses: 0, draws: 0 }; // localStorage unavailable (private mode etc.)
  }
}

/** Call once per finished vs-Bot match to keep the local record honest. */
export function recordVsBotResult(result: VsBotResult): void {
  const rec = readRecord();
  if (result === "win") rec.wins++;
  else if (result === "loss") rec.losses++;
  else rec.draws++;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rec));
  } catch {
    // Private-mode Safari etc. — the record just doesn't persist this run.
  }
}

const MOCK_LADDER: ReadonlyArray<{ name: string; rating: number }> = [
  { name: "double_or_nothing", rating: 1877 },
  { name: "the_patient_one", rating: 1744 },
  { name: "twice_shy", rating: 1560 },
  { name: "allin_annie", rating: 1391 },
  { name: "greedy_gus", rating: 1148 },
];

export interface StandingsButton {
  el: HTMLButtonElement;
}

export function createStandingsButton(): StandingsButton {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn--ghost standings-trigger";
  btn.setAttribute("aria-label", "Standings");
  btn.setAttribute("title", "Standings");
  btn.setAttribute("data-standings-trigger", "");
  btn.textContent = "🏆";
  btn.addEventListener("click", () => openStandingsPanel());
  return { el: btn };
}

function openStandingsPanel(): void {
  const rec = readRecord();
  const total = rec.wins + rec.losses + rec.draws;
  const winPct = total > 0 ? Math.round((rec.wins / total) * 100) : 0;

  const overlay = document.createElement("div");
  overlay.className = "standings-overlay";
  overlay.setAttribute("data-standings-overlay", "");

  const panel = document.createElement("div");
  panel.className = "card standings-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Standings");

  const title = document.createElement("h3");
  title.className = "card__title";
  title.textContent = "Standings";

  const record = document.createElement("p");
  record.className = "standings-panel__record";
  record.setAttribute("data-standings-record", "");
  record.innerHTML =
    `Your vs-Bot record on this device: <strong>${rec.wins}W</strong> – <strong>${rec.losses}L</strong> – ` +
    `<strong>${rec.draws}D</strong>${total > 0 ? ` <span class="standings-panel__pct">(${winPct}% wins)</span>` : ""}`;

  const badge = document.createElement("span");
  badge.className = "badge standings-panel__badge";
  badge.textContent = "Powered by Competios — coming soon";

  const list = document.createElement("ol");
  list.className = "standings-panel__ladder-list";
  for (const entry of MOCK_LADDER) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = entry.name;
    const rating = document.createElement("span");
    rating.className = "standings-panel__rating";
    rating.textContent = String(entry.rating);
    li.append(name, rating);
    list.append(li);
  }

  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn btn--ghost standings-panel__close";
  close.textContent = "Close";
  const dismiss = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  close.addEventListener("click", dismiss);

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") dismiss();
  }
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) dismiss();
  });

  panel.append(title, record, badge, list, close);
  overlay.append(panel);
  document.body.append(overlay);
  close.focus();
}
