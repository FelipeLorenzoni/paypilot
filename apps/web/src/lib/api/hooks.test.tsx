import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type ApiResult } from "./api-error";
import { useApiQuery, useApiMutation } from "./hooks";

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

function fail<T>(code: string, message: string): ApiResult<T> {
  return {
    ok: false,
    error: new ApiError({ code, message, requestId: "req-h-1" }),
  };
}

function QueryProbe({
  fn,
  isEmpty,
  dep = 0,
}: {
  fn: () => Promise<ApiResult<string[]>>;
  isEmpty?: (data: string[]) => boolean;
  dep?: number;
}): ReactNode {
  const state = useApiQuery(fn, [dep], isEmpty);
  if (state.status === "loading") return <p>state:loading</p>;
  if (state.status === "empty") return <p>state:empty</p>;
  if (state.status === "error")
    return (
      <div>
        <p>state:error:{state.error.code}</p>
        <button onClick={state.retry}>retry</button>
      </div>
    );
  return <p>state:loaded:{state.data.join(",")}</p>;
}

describe("useApiQuery", () => {
  it("transitions loading → loaded", async () => {
    let resolve!: (value: ApiResult<string[]>) => void;
    const promise = new Promise<ApiResult<string[]>>((r) => (resolve = r));
    render(<QueryProbe fn={() => promise} />);

    expect(screen.getByText("state:loading")).toBeDefined();
    await act(async () => resolve(ok(["a", "b"])));
    expect(screen.getByText("state:loaded:a,b")).toBeDefined();
  });

  it("detects empty data via isEmpty", async () => {
    render(
      <QueryProbe
        fn={() => Promise.resolve(ok<string[]>([]))}
        isEmpty={(data) => data.length === 0}
      />,
    );
    await waitFor(() => expect(screen.getByText("state:empty")).toBeDefined());
  });

  it("exposes the typed error and retries on demand", async () => {
    const user = userEvent.setup();
    const fn = vi
      .fn<() => Promise<ApiResult<string[]>>>()
      .mockResolvedValueOnce(fail("INTERNAL_ERROR", "boom"))
      .mockResolvedValueOnce(ok(["recovered"]));

    render(<QueryProbe fn={fn} />);
    await waitFor(() =>
      expect(screen.getByText("state:error:INTERNAL_ERROR")).toBeDefined(),
    );

    await user.click(screen.getByRole("button", { name: "retry" }));
    await waitFor(() =>
      expect(screen.getByText("state:loaded:recovered")).toBeDefined(),
    );
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("refetches when deps change", async () => {
    const fn = vi
      .fn<() => Promise<ApiResult<string[]>>>()
      .mockResolvedValue(ok(["page"]));

    function Wrapper(): ReactNode {
      const [dep, setDep] = useState(1);
      return (
        <div>
          <button onClick={() => setDep(2)}>next</button>
          <QueryProbe fn={fn} dep={dep} />
        </div>
      );
    }

    const user = userEvent.setup();
    render(<Wrapper />);
    await waitFor(() =>
      expect(screen.getByText("state:loaded:page")).toBeDefined(),
    );
    await user.click(screen.getByRole("button", { name: "next" }));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
  });
});

function MutationProbe({
  fn,
}: {
  fn: (input: string) => Promise<ApiResult<string>>;
}): ReactNode {
  const { run, pending, error } = useApiMutation(fn);
  return (
    <div>
      <button onClick={() => void run("input")}>run</button>
      {pending ? <p>mutation:pending</p> : null}
      {error ? <p>mutation:error:{error.code}</p> : null}
    </div>
  );
}

describe("useApiMutation", () => {
  it("tracks pending state and returns the result", async () => {
    const user = userEvent.setup();
    let resolve!: (value: ApiResult<string>) => void;
    const promise = new Promise<ApiResult<string>>((r) => (resolve = r));
    render(<MutationProbe fn={() => promise} />);

    await user.click(screen.getByRole("button", { name: "run" }));
    expect(screen.getByText("mutation:pending")).toBeDefined();

    await act(async () => resolve(ok("done")));
    expect(screen.queryByText("mutation:pending")).toBeNull();
    expect(screen.queryByText(/mutation:error/)).toBeNull();
  });

  it("exposes the typed error on failure and clears it on the next run", async () => {
    const user = userEvent.setup();
    const fn = vi
      .fn<(input: string) => Promise<ApiResult<string>>>()
      .mockResolvedValueOnce(fail("CONFLICT", "exists"))
      .mockResolvedValueOnce(ok("done"));
    render(<MutationProbe fn={fn} />);

    await user.click(screen.getByRole("button", { name: "run" }));
    await waitFor(() =>
      expect(screen.getByText("mutation:error:CONFLICT")).toBeDefined(),
    );

    await user.click(screen.getByRole("button", { name: "run" }));
    await waitFor(() =>
      expect(screen.queryByText(/mutation:error/)).toBeNull(),
    );
  });
});
