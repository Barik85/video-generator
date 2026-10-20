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
  title: "Нічна заправка, червоний плащ",
  language: "uk",
  logline: "Дівчина під дощем передає касиру конверт, який не можна відкривати до ранку.",
  style: "cinematic, rainy neon night, 35mm, shallow depth of field",
  characters: [
    { id: "girl", name: "Дівчина", look: "жінка близько 25 років, червоний плащ, мокре темне волосся до плечей", voice: "female" },
    { id: "clerk", name: "Касир", look: "чоловік близько 40, сіра уніформа заправки, втомлені очі", voice: "male" },
  ],
  lines: [{ id: "l1", characterId: "girl", text: "Ти знаєш, що там. Не відкривай до ранку." }],
  shots: [
    { id: "s1", visual: "Дощ, неон заправки, дівчина в червоному плащі заходить у касу.", camera: "wide → medium, slow push-in", characterIds: ["girl"], lineIds: [], approxSeconds: 6 },
    { id: "s2", visual: "Простягає конверт касиру, голова нерухома під час репліки.", camera: "locked medium close-up", characterIds: ["girl", "clerk"], lineIds: ["l1"], approxSeconds: 9 },
  ],
};

const bridge: Script = {
  title: "Двоє під мостом",
  language: "uk",
  logline: "Двоє незнайомців ховаються від зливи під одним мостом.",
  style: "overcast, heavy rain, cold blue grade, handheld",
  characters: [
    { id: "a", name: "Він", look: "чоловік 30 років, мокра джинсова куртка", voice: "male" },
    { id: "b", name: "Вона", look: "жінка 30 років, жовтий дощовик", voice: "female" },
  ],
  lines: [
    { id: "l1", characterId: "a", text: "Здається, ми вже колись тут стояли." },
    { id: "l2", characterId: "b", text: "Десять років тому. Ти тоді теж мовчав." },
  ],
  shots: [
    { id: "s1", visual: "Під мостом, стіна дощу, двоє стоять на відстані.", camera: "wide, static", characterIds: ["a", "b"], lineIds: [], approxSeconds: 5 },
    { id: "s2", visual: "Він дивиться на неї.", camera: "medium close-up on him", characterIds: ["a"], lineIds: ["l1"], approxSeconds: 6 },
    { id: "s3", visual: "Вона відповідає, не дивлячись.", camera: "medium close-up on her", characterIds: ["b"], lineIds: ["l2"], approxSeconds: 7 },
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
    input: { idea: "Пес чекає господаря під дверима лікарні. Медсестра каже: \"He's coming home today, buddy.\"", targetSeconds: 8, preset: "mock", budgetUsd: 1 },
    scenario: { script: dog },
  },
  {
    input: { idea: "Ранковий потяг, двоє колишніх сідають навпроти. Вона каже: «Ти зовсім не змінився.»", targetSeconds: 20, preset: "seedance-2.5", budgetUsd: 4 },
    scenario: { failAt: { stage: "video", error: "Budget guard: next video clip would exceed the $4.00 limit" } },
  },
  {
    input: { idea: "Двоє незнайомців ховаються від зливи під одним мостом.", targetSeconds: 18, preset: "seedance-fast", budgetUsd: 8 },
    scenario: { script: bridge, heard: { l2: "Десять років тому. Ти тоді теж мовчав би." }, videoRetries: { s3: 1 } },
  },
  {
    input: {
      idea: "Нічна заправка під дощем. Дівчина в червоному плащі простягає касиру конверт і каже: «Ти знаєш, що там. Не відкривай до ранку.»",
      targetSeconds: 15,
      preset: "seedance-fast",
      budgetUsd: 8,
    },
    scenario: { script: gasStation, videoRetries: { s2: 1 } },
  },
  {
    input: { idea: "Кур’єр приносить посилку не на ту адресу, а там лист для неї. «Це вам. Він просив передати особисто.»", targetSeconds: 15, preset: "seedance-fast", budgetUsd: 8 },
    scenario: { stopAt: "video" },
  },
];

for (const s of seeds) {
  const m = await fakeStartRun({ runsRoot: RUNS_ROOT, input: RunInput.parse(s.input), scenario: s.scenario });
  console.log(`${m.runId}  ${m.status.padEnd(7)}  $${m.cost.totalUsd.toFixed(2)}  ${s.input.idea.slice(0, 60)}`);
  await new Promise((r) => setTimeout(r, 1100)); // distinct createdAt seconds → stable ordering
}
console.log(`\nwrote ${seeds.length} runs to ${RUNS_ROOT}`);
