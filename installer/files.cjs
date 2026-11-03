// File operations for installing, parameterised by the fs module so they run in tests with plain Node.
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");

/** Top-level names every Electron app folder ships with. */
const RUNTIME = /^(locales|resources|swiftshader|.+\.(dll|pak|bin|dat)|licenses?\..+|vk_swiftshader_icd\.json)$/i;

/** `marker` is the file that identifies a folder as our install; `companions` are other files only we put there. */
function createFiles(fs, marker, companions = []) {
  const exists = (file) => fs.existsSync(file);
  const ownNames = new Set([marker, ...companions].map((name) => name.toLowerCase()));
  const signs = [marker, ...companions, path.join("resources", "app.asar"), "icudtl.dat"];

  /** Our install, or what an interrupted install or uninstall left of it: some of our files and nothing else. */
  function isOurs(dir) {
    if (exists(path.join(dir, marker))) return true;
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return false;
    }
    return (
      names.length > 0 &&
      signs.some((sign) => exists(path.join(dir, sign))) &&
      names.every((name) => ownNames.has(name.toLowerCase()) || RUNTIME.test(name) || name.startsWith(".tungee-"))
    );
  }

  function isEmptyDir(dir) {
    try {
      return fs.readdirSync(dir).length === 0;
    } catch {
      return !exists(dir);
    }
  }

  function nearestExisting(target) {
    let dir = path.resolve(target);
    while (!exists(dir)) {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return dir;
  }

  function canWrite(dir) {
    try {
      fs.rmdirSync(fs.mkdtempSync(path.join(dir, ".tungee-")));
      return true;
    } catch {
      return false;
    }
  }

  /** A running exe can't be opened for writing on Windows. */
  function isLocked(file) {
    try {
      fs.closeSync(fs.openSync(file, "r+"));
      return false;
    } catch (error) {
      return error.code === "EBUSY";
    }
  }

  /** Reads one JSON file out of an asar archive and closes it again. Electron's own asar support keeps the
   * archive open for the life of the process, which would stop the folder holding it from being renamed. */
  function readAsarJson(archive, name) {
    const fd = fs.openSync(archive, "r");
    try {
      const read = (length, position) => {
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, position);
        return buffer;
      };
      const head = read(16, 0);
      const headerSize = head.readUInt32LE(4);
      const header = JSON.parse(read(head.readUInt32LE(12), 16).toString("utf8"));
      const entry = header.files[name];
      return JSON.parse(read(entry.size, 8 + headerSize + Number(entry.offset)).toString("utf8"));
    } finally {
      fs.closeSync(fd);
    }
  }

  async function listFiles(root) {
    const found = [];
    async function walk(dir) {
      for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) found.push({ src: full, rel: path.relative(root, full), size: (await fs.promises.stat(full)).size });
      }
    }
    await walk(root);
    return found;
  }

  async function retry(action, attempts = 10, delay = 300) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await action();
      } catch (error) {
        // Antivirus scanners briefly hold freshly written files.
        if (attempt >= attempts || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) throw error;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /** Copies `jobs` ({ src, rel }) into `dir`, reporting bytes as they go. Streaming copies only the contents,
   * leaving behind the downloaded-from-internet mark (the Zone.Identifier stream). */
  async function copyAll(jobs, dir, signal, onBytes) {
    for (const job of jobs) {
      signal.throwIfAborted();
      const dst = path.join(dir, job.rel);
      await ensureDir(path.dirname(dst));
      const counter = new Transform({
        transform(chunk, _encoding, callback) {
          onBytes(job, chunk.length);
          callback(null, chunk);
        },
      });
      await pipeline(fs.createReadStream(job.src), counter, fs.createWriteStream(dst), { signal });
    }
  }

  /** Creates `dir` unless it's already there; Windows rejects mkdir on a drive root even with `recursive`. */
  async function ensureDir(dir) {
    if (!exists(dir)) await fs.promises.mkdir(dir, { recursive: true });
  }

  const removeTree = (dir) => fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });

  /** Hidden folders inside the install holding the previous version's files during an in-place update. */
  const OLD_FILES = ".tungee-old-";

  async function removeOldFiles(target) {
    let names = [];
    try {
      names = await fs.promises.readdir(target);
    } catch {}
    for (const name of names.filter((entry) => entry.startsWith(OLD_FILES))) {
      // Files of a program that's still running can't be deleted yet; the next update tries again.
      await fs.promises.rm(path.join(target, name), { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Moves the old install's files one by one into a hidden folder inside it. This works where renaming the whole
   * folder doesn't: with an Explorer window or a command prompt open in it, or a program still running from it,
   * since Windows lets running exes and loaded DLLs be renamed though not deleted or overwritten. */
  async function moveFilesAside(target) {
    const bin = path.join(target, `${OLD_FILES}${Date.now()}`);
    const moved = [];
    try {
      for (const file of await listFiles(target)) {
        if (file.rel.startsWith(OLD_FILES)) continue;
        const dst = path.join(bin, file.rel);
        await ensureDir(path.dirname(dst));
        await retry(() => fs.promises.rename(file.src, dst), 6, 500);
        moved.push(file.rel);
      }
    } catch (error) {
      await putFilesBack(target, { bin, moved });
      throw Object.assign(error, { code: "LOCKED", cause: error.code });
    }
    return { bin, moved };
  }

  async function putFilesBack(target, { bin, moved }) {
    let complete = true;
    for (const rel of moved) {
      const dst = path.join(target, rel);
      await ensureDir(path.dirname(dst));
      await retry(() => fs.promises.rename(path.join(bin, rel), dst), 6, 500).catch(() => (complete = false));
    }
    if (complete) await removeTree(bin).catch(() => undefined);
  }

  /** Copies `jobs` straight into `target`. An existing install is moved aside first and put back if the copy
   * fails or is cancelled. Only the old, long-settled files are ever renamed: freshly written ones are often
   * still held by the virus scanner, which makes renaming their folder fail. */
  async function installInto(jobs, target, signal, onBytes) {
    const aside = `${target}~old`;
    let restore = null;
    let renamed = false;
    if (exists(target) && !isEmptyDir(target)) {
      if (!isOurs(target)) throw Object.assign(new Error(`occupied: ${target}`), { code: "OCCUPIED" });
      await removeTree(aside).catch(() => undefined);
      renamed = !exists(aside) && (await retry(() => fs.promises.rename(target, aside), 6, 500).then(() => true, () => false));
      if (renamed) {
        restore = async () => {
          await removeTree(target).catch(() => undefined);
          await retry(() => fs.promises.rename(aside, target), 20, 500).catch(() => undefined);
        };
      } else {
        const old = await moveFilesAside(target);
        restore = async () => {
          for (const name of await fs.promises.readdir(target)) {
            if (!name.startsWith(OLD_FILES)) await removeTree(path.join(target, name)).catch(() => undefined);
          }
          await putFilesBack(target, old);
        };
      }
    }
    try {
      await ensureDir(target);
      await copyAll(jobs, target, signal, onBytes);
    } catch (error) {
      if (restore) await restore().catch(() => undefined);
      else await removeTree(target).catch(() => undefined);
      throw error;
    }
    // Also clears what an update that was cut off, or couldn't delete a running program's files, left behind.
    await removeOldFiles(target);
    if (renamed || isOurs(aside)) await removeTree(aside).catch(() => undefined);
  }

  return { exists, isOurs, isEmptyDir, nearestExisting, canWrite, isLocked, readAsarJson, listFiles, retry, ensureDir, copyAll, installInto };
}

/** True when the two folders are the same or one contains the other. */
function overlaps(a, b) {
  const x = path.resolve(a).toLowerCase() + path.sep;
  const y = path.resolve(b).toLowerCase() + path.sep;
  return x.startsWith(y) || y.startsWith(x);
}

module.exports = { createFiles, overlaps };
