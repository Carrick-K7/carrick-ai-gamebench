import {
  access,
  copyFile,
  cp,
  lstat,
  mkdir,
  readdir,
  stat,
} from "node:fs/promises";
import path from "node:path";
import {
  canonicalJson,
  sha256Buffer,
  sha256File,
  type ArtifactRef,
  type ArtifactRole,
  type JsonValue,
} from "@carrick/gamebench-core";

export interface PutArtifactOptions {
  role: ArtifactRole;
  fileName: string;
  mediaType: string;
  kind?: "file" | "directory";
}

export interface ArtifactStore {
  put(sourcePath: string, options: PutArtifactOptions): Promise<ArtifactRef>;
  exists(artifact: ArtifactRef): Promise<boolean>;
  resolveUrl(
    artifactId: `sha256:${string}`,
    fileName: string,
    role: ArtifactRole,
  ): string;
}

function safeFileName(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) {
    throw new Error(`unsafe artifact file name: ${value}`);
  }
  return value;
}

function joinUrl(baseUrl: string, relative: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${relative.replace(/^\/+/, "")}`;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

interface DirectoryFile {
  path: string;
  sha256: string;
  size: number;
}

async function directoryFiles(
  root: string,
  current = root,
): Promise<DirectoryFile[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: DirectoryFile[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`artifact directory contains a symlink: ${absolute}`);
    }
    if (entry.isDirectory()) {
      files.push(...await directoryFiles(root, absolute));
    } else if (entry.isFile()) {
      const info = await stat(absolute);
      files.push({
        path: path.relative(root, absolute).split(path.sep).join("/"),
        sha256: `sha256:${await sha256File(absolute)}`,
        size: info.size,
      });
    }
  }
  return files;
}

async function directoryIdentity(
  root: string,
): Promise<{ id: `sha256:${string}`; bytes: number }> {
  const files = await directoryFiles(root);
  const identity = JSON.parse(JSON.stringify({ files })) as JsonValue;
  return {
    id: sha256Buffer(Buffer.from(canonicalJson(identity), "utf8")),
    bytes: files.reduce((sum, file) => sum + file.size, 0),
  };
}

export class FilesystemArtifactStore implements ArtifactStore {
  readonly root: string;
  readonly baseUrl: string;

  constructor(root: string, baseUrl = "/") {
    this.root = path.resolve(root);
    this.baseUrl = baseUrl;
  }

  resolveUrl(
    artifactId: `sha256:${string}`,
    fileName: string,
    role: ArtifactRole,
  ): string {
    const digest = artifactId.slice("sha256:".length);
    if (role === "playable") {
      return joinUrl(this.baseUrl, `play/${digest}/index.html`);
    }
    return joinUrl(
      this.baseUrl,
      `objects/sha256/${digest.slice(0, 2)}/${digest}/${safeFileName(fileName)}`,
    );
  }

  private destination(
    artifactId: `sha256:${string}`,
    fileName: string,
    role: ArtifactRole,
  ): string {
    const digest = artifactId.slice("sha256:".length);
    return role === "playable"
      ? path.join(this.root, "play", digest)
      : path.join(
          this.root,
          "objects",
          "sha256",
          digest.slice(0, 2),
          digest,
          safeFileName(fileName),
        );
  }

  async put(
    sourcePath: string,
    options: PutArtifactOptions,
  ): Promise<ArtifactRef> {
    const absoluteSource = path.resolve(sourcePath);
    const sourceInfo = await lstat(absoluteSource);
    if (sourceInfo.isSymbolicLink()) {
      throw new Error(`artifact source must not be a symlink: ${sourcePath}`);
    }
    const kind = options.kind ?? "file";
    if (kind === "directory" && !sourceInfo.isDirectory()) {
      throw new Error(`artifact source is not a directory: ${sourcePath}`);
    }
    if (kind === "file" && !sourceInfo.isFile()) {
      throw new Error(`artifact source is not a file: ${sourcePath}`);
    }

    const identity = kind === "directory"
      ? await directoryIdentity(absoluteSource)
      : {
          id: `sha256:${await sha256File(absoluteSource)}` as const,
          bytes: sourceInfo.size,
        };
    const destination = this.destination(
      identity.id,
      options.fileName,
      options.role,
    );
    if (!(await pathExists(destination))) {
      await mkdir(path.dirname(destination), { recursive: true });
      if (kind === "directory") {
        await cp(absoluteSource, destination, {
          recursive: true,
          errorOnExist: true,
        });
      } else {
        await copyFile(absoluteSource, destination);
      }
    }

    return {
      artifact_id: identity.id,
      role: options.role,
      file_name: safeFileName(options.fileName),
      size_bytes: identity.bytes,
      media_type: options.mediaType,
      url: this.resolveUrl(identity.id, options.fileName, options.role),
    };
  }

  async exists(artifact: ArtifactRef): Promise<boolean> {
    return pathExists(
      this.destination(
        artifact.artifact_id as `sha256:${string}`,
        artifact.file_name,
        artifact.role,
      ),
    );
  }
}
