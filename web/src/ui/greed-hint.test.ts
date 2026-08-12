// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { duelDetail } from "../engine/greedplay";
import { createGreedHint, greedHint } from "./greed-hint";

describe("greedHint: the threshold it states is the real rule", () => {
  it("names exactly the opponent bids that would punish you, for every bid up to 200", () => {
    for (let mine = 1; mine <= 200; mine++) {
      const { threshold } = greedHint(mine);
      for (let theirs = 1; theirs < mine; theirs++) {
        // `greedy` on a duel where I am the higher bidder means I am the one
        // being punished — which is precisely what the hint promises.
        expect(duelDetail(mine, theirs).greedy, `mine=${mine} theirs=${theirs}`).toBe(theirs <= threshold);
      }
    }
  });

  it("reports a bid of 1 or 2 as unconditionally safe", () => {
    for (const bid of [1, 2]) {
      const hint = greedHint(bid);
      expect(hint.threshold).toBe(0);
      expect(hint.tone).toBe("safe");
      expect(hint.text).toContain("can never be greedy");
    }
  });

  it("states the risk line for a bid that has one", () => {
    expect(greedHint(10)).toMatchObject({ threshold: 4, tone: "risk" });
    expect(greedHint(10).text).toBe("If your opponent bids 4 or less, your 10 is greed — they take the round.");
    // The singular case reads as "1", not "1 or less".
    expect(greedHint(3).text).toBe("If your opponent bids 1, your 3 is greed — they take the round.");
  });

  it("reports what the bid can cost: never more than the bid itself", () => {
    expect(greedHint(37).atRisk).toBe(37);
  });
});

describe("greedHint: the secrecy contract", () => {
  it("takes exactly one argument, so no opponent state can reach it", () => {
    // A hint that could see the opponent's hidden bid would leak the game.
    // Pinning the arity makes that a test failure rather than a code review.
    expect(greedHint.length).toBe(1);
  });

  it("is a pure function of the local bid — same bid, same sentence, always", () => {
    const first = greedHint(23);
    for (let i = 0; i < 10; i++) expect(greedHint(23)).toEqual(first);
  });
});

describe("createGreedHint", () => {
  it("renders and updates from the local bid alone", () => {
    const view = createGreedHint(10);
    expect(view.el.getAttribute("data-greed-hint")).toBe("");
    expect(view.el.dataset.tone).toBe("risk");
    expect(view.el.dataset.threshold).toBe("4");
    expect(view.el.textContent).toContain("your 10 is greed");

    view.update(2);
    expect(view.el.dataset.tone).toBe("safe");
    expect(view.el.dataset.threshold).toBe("0");
    expect(view.el.textContent).toContain("can never be greedy");
  });

  it("exposes only a one-argument update, so the view cannot be fed opponent state either", () => {
    expect(createGreedHint(1).update.length).toBe(1);
  });

  it("announces politely rather than assertively (it changes on every tick)", () => {
    expect(createGreedHint(5).el.getAttribute("aria-live")).toBe("polite");
  });
});
