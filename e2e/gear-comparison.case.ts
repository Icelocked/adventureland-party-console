import { test, expect } from "./fixtures";
import { build } from "esbuild";
import path from "node:path";

// Failure modes: offhand stats/set membership survive a two-handed replacement;
// edited set bonuses become the live baseline; opt-out changes the proposal;
// reopening retains opt-out; one-handed proposals lose the offhand.
// Game metadata is a declared boundary; the maintained dialog runs in Chromium.
test("equipment comparison removes two-handed offhands and recalculates both sets", async ({
  page,
  app,
}, info) => {
  const bundle = await build({
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    tsconfig: path.resolve("dashboard/tsconfig.json"),
    stdin: {
      resolveDir: path.resolve("dashboard"),
      loader: "tsx",
      contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {GearComparisonDialog} from './features/party/gear-comparison-dialog';
    const root=createRoot(document.getElementById('root'));
    window.mountComparison=(comparison)=>root.render(<GearComparisonDialog comparison={comparison} onOpenChange={()=>root.render(null)}/>);
  `,
    },
  });
  await page.goto(app.url);
  await expect(page.locator("body")).toContainText("Party");
  const styles = await page
    .locator('style, link[rel="stylesheet"]')
    .evaluateAll((nodes) => nodes.map((node) => node.outerHTML).join("\n"));
  await page.route("**/comparison-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><head>${styles}</head><body><div id="root"></div></body>`,
    }),
  );
  await page.goto(app.url + "/comparison-harness");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const set = (id: string, items: string[], int: number) => ({
    id,
    name: id,
    items: items.map((id) => ({ id, name: id, quantity: 1, sprite: null })),
    bonuses: [{ pieces: 2, stats: { int } }],
  });
  const bookSet = set("Book set", ["book", "helmet"], 10),
    staffSet = set("Staff set", ["sparkstaff", "ring"], 20);
  const gear = (
    name: string,
    properties: Record<string, number>,
    hands: number | null,
    setInfo?: ReturnType<typeof set>,
  ) => ({
    item: { name, level: 0 },
    meta: {
      definition: { name, type: hands ? "weapon" : "armor" },
      properties,
      usage: { classes: [{ id: "mage", hands }], hands: [hands] },
      world: { set: setInfo },
    },
  });
  const character = {
    name: "Qwentina",
    ctype: "mage",
    level: 80,
    primaryStat: "int",
    int: 100,
    str: 10,
    dex: 10,
    vit: 10,
    hp: 1000,
    max_hp: 1000,
    mp: 2000,
    max_mp: 2000,
    attack: 600,
    armor: 50,
    resistance: 100,
    frequency: 1,
    speed: 30,
    range: 100,
    slots: {
      mainhand: gear("wand", { attack: 100, int: 5 }, 1),
      offhand: gear("book", { int: 15, armor: 40 }, null, bookSet),
      helmet: gear("helmet", {}, null, bookSet),
      ring1: gear("ring", {}, null, staffSet),
    },
    items: [],
  };
  const comparison = {
    character,
    slot: "mainhand",
    entry: { slot: 0, ...gear("sparkstaff", { attack: 150, int: 10 }, 2, staffSet) },
  };
  const mount = async (value: unknown) =>
    page.evaluate((value) => (window as any).mountComparison(value), value);
  await mount(comparison);
  const checkbox = page.getByRole("checkbox", {
    name: "include offhand weapon in comparison",
    exact: true,
  });
  await expect(checkbox).toBeChecked();
  const panels = page.getByRole("region");
  const stat = (side: number, label: string) =>
    panels.nth(side).getByText(label, { exact: true }).locator("..");
  await expect(stat(0, "INT")).toContainText("100");
  await expect(stat(1, "INT")).toContainText("100"); // +5 mainhand -15 book -10 set +20 set
  await expect(stat(1, "Armor")).toContainText("-40.0");
  await expect(stat(1, "Attack")).toContainText("900.0");
  await expect(page.getByText(/Book set: 2\/2/)).toContainText("1/2");
  await expect(page.getByText(/Staff set: 1\/2/)).toContainText("2/2");
  await expect(page.getByText(/2 pieces: INT \+10/)).toContainText("LOST");
  await expect(page.getByText(/2 pieces: INT \+20/)).toContainText("GAINED");
  const checked = await panels.allTextContents();
  await info.attach("offhand-comparison-default", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await page.getByText("Set changes", { exact: true }).scrollIntoViewIfNeeded();
  await info.attach("offhand-comparison-set-changes", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await checkbox.uncheck();
  await expect(stat(0, "INT")).toContainText("75");
  await expect(stat(0, "Attack")).toContainText("475.0");
  await expect(stat(1, "INT")).toContainText("+25");
  await expect(stat(1, "Attack")).toContainText("900.0");
  await info.attach("offhand-comparison-ledger", {
    body: JSON.stringify({ comparison, checked, unchecked: await panels.allTextContents() }),
    contentType: "application/json",
  });
  await info.attach("offhand-comparison-browser", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await mount(null);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await mount(comparison);
  await expect(checkbox).toBeChecked();
  await mount({
    ...comparison,
    entry: { slot: 1, ...gear("otherwand", { attack: 150, int: 10 }, 1) },
  });
  await expect(checkbox).toHaveCount(0);
  await expect(stat(1, "INT")).toContainText("105");
  await expect(stat(1, "Armor")).not.toContainText("-40.0");
  // Native set entries are total bonuses for an exact equipped piece count.
  const tieredSet = { ...bookSet,
    items: [...bookSet.items, { id: "boots", name: "boots", quantity: 1, sprite: null }],
    bonuses: [{ pieces: 2, stats: { int: 10 } }, { pieces: 3, stats: { int: 30 } }],
  };
  await mount({ ...comparison, character: { ...character, int: 120, attack: 700, slots: {
    ...character.slots,
    offhand: gear("book", { int: 15, armor: 40 }, null, tieredSet),
    helmet: gear("helmet", {}, null, tieredSet),
    shoes: gear("boots", {}, null, tieredSet),
  } } });
  await expect(stat(0, "INT")).toContainText("120");
  await expect(stat(1, "INT")).toContainText("110");
  await expect(page.getByText(/Book set: 3\/3/)).toContainText("2/3");
  await expect(page.getByText(/3 pieces: INT \+30/)).toContainText("LOST");
  await expect(page.getByText(/3 pieces: INT \+30/)).toContainText("2 pieces: INT +10 · GAINED");
  await info.attach("offhand-comparison-tiered-sets", { body: JSON.stringify(await panels.allTextContents()), contentType: "application/json" });
});
