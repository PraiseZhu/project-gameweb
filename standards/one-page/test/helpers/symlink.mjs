import { symlinkSync } from 'node:fs';

// A skipped subtest reports exactly which security probe could not run.
// Catch only link creation EPERM; assertion failures must still fail the test.
export async function symlinkProbe(context, name, target, path, check) {
  await context.test(name, async (probe) => {
    try {
      symlinkSync(target, path);
    } catch (error) {
      if (error.code !== 'EPERM') throw error;
      probe.skip('File symlink creation denied (EPERM)');
      return;
    }
    await check();
  });
}
