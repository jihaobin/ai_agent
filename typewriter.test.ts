import { expect, test } from "bun:test";
import { writeTypewriterText } from "./typewriter";

test("writeTypewriterText writes characters in order", async () => {
  const written: string[] = [];

  await writeTypewriterText("abc", {
    delayMs: 0,
    write: (value) => {
      written.push(value);
    },
  });

  expect(written).toEqual(["a", "b", "c"]);
});
