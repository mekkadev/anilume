import type { Resource } from "solid-js";

export function settled<T>(resource: Resource<T>): T | undefined {
  return resource.state === "ready" ? resource() : undefined;
}

export function broke(resource: Resource<unknown>) {
  return resource.state === "errored";
}

export function pending(resource: Resource<unknown>) {
  return resource.state === "pending" || resource.state === "refreshing";
}
