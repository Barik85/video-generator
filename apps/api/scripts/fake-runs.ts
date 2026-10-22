/**
 * Seeds demo run folders (schema-valid manifests, events, stage outputs and placeholder media made
 * with ffmpeg) so the UI can be built and demoed before the real runner lands.
 *
 *   npm run fake-runs -w @reel/api            # writes into $RUNS_DIR or <repo>/runs
 */
import { RunInput, type Script } from "@reel/core";
import { RUNS_ROOT } from "../src/env.ts";
import { fakeStartRun, type Scenario } from "../src/fake/simulate.ts";

const gasStation: Script = {
  title: "Night gas station, red raincoat",
  language: "en",
  logline: "A girl in the rain hands the cashier an envelope that must not be opened until morning.",
  style: "cinematic, rainy neon night, 35mm, shallow depth of field",
  characters: [
    { id: "girl", name: "Girl", look: "woman around 25, red raincoat, wet shoulder-length dark hair", voice: "female" },
    { id: "clerk", name: "Cashier", look: "man around 40, grey gas station uniform, tired eyes", voice: "male" },
  ],
  lines: [{ id: "l1", characterId: "girl", text: "You know what is inside. Do not open it until morning." }],
  shots: [
    { id: "s1", visual: "Rain, gas station neon, a girl in a red raincoat walks into the kiosk.", camera: "wide → medium, slow push-in", characterIds: ["girl"], lineIds: [], approxSeconds: 6 },
    { id: "s2", visual: "She slides the envelope to the cashier, head still during the line.", camera: "locked medium close-up", characterIds: ["girl", "clerk"], lineIds: ["l1"], approxSeconds: 9 },
  ],
};

const bridge: Script = {
  title: "Two under a bridge",
  language: "en",
  logline: "Two strangers shelter from a downpour under the same bridge.",
  style: "overcast, heavy rain, cold blue grade, handheld",
  characters: [
    { id: "a", name: "He", look: "man, 30, wet denim jacket", voice: "male" },
    { id: "b", name: "She", look: "woman, 30, yellow raincoat", voice: "female" },
  ],
  lines: [
    { id: "l1", characterId: "a", text: "I think we have stood here before." },
    { id: "l2", characterId: "b", text: "Ten years ago. You were silent then too." },
  ],
  shots: [
    { id: "s1", visual: "Under the bridge, a wall of rain, two people stand apart.", camera: "wide, static", characterIds: ["a", "b"], lineIds: [], approxSeconds: 5 },
    { id: "s2", visual: "He looks at her.", camera: "medium close-up on him", characterIds: ["a"], lineIds: ["l1"], approxSeconds: 6 },
    { id: "s3", visual: "She answers without looking at him.", camera: "medium close-up on her", characterIds: ["b"], lineIds: ["l2"], approxSeconds: 7 },
  ],
};

const dog: Script = {
  title: "Dog at the hospital door",
  language: "en",
  logline: "A dog waits for its owner outside the hospital doors.",
  style: "soft morning light, warm, 50mm",
  characters: [{ id: "nurse", name: "Nurse", look: "woman, 50s, blue scrubs, kind eyes", voice: "female" }],
  lines: [{ id: "l1", characterId: "nurse", text: "He's coming home today, buddy." }],
  shots: [{ id: "s1", visual: "A nurse kneels next to a golden retriever by the hospital doors.", camera: "locked medium shot", characterIds: ["nurse"], lineIds: ["l1"], approxSeconds: 8 }],
};

const seeds: Array<{ input: Partial<RunInput> & { idea: string }; scenario: Scenario }> = [
  {
    input: { idea: "A dog waits for its owner outside the hospital doors. A nurse says: \"He's coming home today, buddy.\"", targetSeconds: 8, preset: "mock", budgetUsd: 1 },
    scenario: { script: dog },
  },
  {
    input: { idea: 'A morning train, two exes sit down facing each other. She says: "You have not changed at all."', targetSeconds: 20, preset: "seedance-2.5", budgetUsd: 4 },
    scenario: { failAt: { stage: "video", error: "Budget guard: next video clip would exceed the $4.00 limit" } },
  },
  {
    input: { idea: "Two strangers shelter from a downpour under the same bridge.", targetSeconds: 18, preset: "seedance-fast", budgetUsd: 8 },
    scenario: { script: bridge, heard: { l2: "Ten years ago. You would have been silent then too." }, videoRetries: { s3: 1 } },
  },
  {
    input: {
      idea: 'A night gas station in the rain. A girl in a red raincoat slides an envelope to the cashier and says: "You know what is inside. Do not open it until morning."',
      targetSeconds: 15,
      preset: "seedance-fast",
      budgetUsd: 8,
    },
    scenario: { script: gasStation, videoRetries: { s2: 1 } },
  },
  {
    input: { idea: 'A courier brings a parcel to the wrong address, and inside is a letter for her. "This is for you. He asked me to hand it over in person."', targetSeconds: 15, preset: "seedance-fast", budgetUsd: 8 },
    scenario: { stopAt: "video" },
  },
];

for (const s of seeds) {
  const m = await fakeStartRun({ runsRoot: RUNS_ROOT, input: RunInput.parse(s.input), scenario: s.scenario });
  console.log(`${m.runId}  ${m.status.padEnd(7)}  $${m.cost.totalUsd.toFixed(2)}  ${s.input.idea.slice(0, 60)}`);
  await new Promise((r) => setTimeout(r, 1100)); // distinct createdAt seconds → stable ordering
}
console.log(`\nwrote ${seeds.length} runs to ${RUNS_ROOT}`);
