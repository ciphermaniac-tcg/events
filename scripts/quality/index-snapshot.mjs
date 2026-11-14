import { execFileSync } from 'node:child_process';
import { existsSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

/** Materialize the index so unstaged fixes cannot make a broken commit pass. */
export function checkoutIndex(repository, directory) {
  const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
  git(['checkout-index', '--all', `--prefix=${directory}${sep}`]);
  writeFileSync(join(directory, '.git'), `gitdir: ${git(['rev-parse', '--absolute-git-dir'])}\n`);
  // The desktop app keeps its own dependencies, which its panel's checks resolve.
  for (const name of ['node_modules', '.venv', join('native', 'node_modules')]) {
    const source = join(repository, name);
    const target = join(directory, name);
    if (existsSync(source) && existsSync(dirname(target))) {
      symlinkSync(source, target, 'junction');
    }
  }
}
