const VALUE_FLAGS = new Set([
  'adapter', 'a', 'model', 'm', 'concurrency', 'c', 'args', 'cwd', 'timeout', 'retries', 'journal',
]);

export type ParsedArgv = {
  positionals: string[];
  flags: Map<string, string | undefined>;
  passthrough: string[];
};

export function parseArgv(argv: string[]): ParsedArgv {
  const separator = argv.indexOf('--');
  const own = separator === -1 ? argv : argv.slice(0, separator);
  const passthrough = separator === -1 ? [] : argv.slice(separator + 1);
  const positionals: string[] = [];
  const flags = new Map<string, string | undefined>();

  for (let i = 0; i < own.length; i += 1) {
    const token = own[i];
    if (!token.startsWith('-')) {
      positionals.push(token);
      continue;
    }
    const name = token.replace(/^-+/, '');
    if (name.includes('=')) {
      const [key, ...rest] = name.split('=');
      flags.set(key, rest.join('='));
      continue;
    }
    if (VALUE_FLAGS.has(name) && i + 1 < own.length) {
      flags.set(name, own[i + 1]);
      i += 1;
      continue;
    }
    flags.set(name, undefined);
  }

  return { positionals, flags, passthrough };
}
