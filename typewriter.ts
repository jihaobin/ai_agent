type TypewriterWrite = (value: string) => void;

type WriteTypewriterTextOptions = {
  delayMs?: number;
  write?: TypewriterWrite;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function writeTypewriterText(
  text: string,
  options: WriteTypewriterTextOptions = {},
) {
  const { delayMs = 20, write = (value: string) => process.stdout.write(value) } =
    options;

  for (const character of text) {
    write(character);

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }
}
