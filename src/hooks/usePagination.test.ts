import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { usePagination } from "./usePagination";

describe("usePagination", () => {
  it("clamps requested page into the valid range", () => {
    const onPageChange = vi.fn();
    const { result } = renderHook(() =>
      usePagination({ totalItems: 40, pageSize: 10, initialPage: 2, onPageChange }),
    );

    onPageChange.mockClear();

    act(() => result.current.goToPage(0));

    expect(result.current.currentPage).toBe(1);
    expect(onPageChange).toHaveBeenCalledTimes(1);
    expect(onPageChange).toHaveBeenLastCalledWith(1);
  });

  it("does not trigger callbacks when a clamped page matches the current value", () => {
    const onPageChange = vi.fn();
    const { result } = renderHook(() =>
      usePagination({ totalItems: 40, pageSize: 10, initialPage: 4, onPageChange }),
    );

    onPageChange.mockClear();

    act(() => result.current.goToPage(10));

    expect(result.current.currentPage).toBe(4);
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("invokes callbacks when navigating to a different in-range page", () => {
    const onPageChange = vi.fn();
    const { result } = renderHook(() =>
      usePagination({ totalItems: 20, pageSize: 5, onPageChange }),
    );

    onPageChange.mockClear();

    act(() => result.current.goToPage(3));

    expect(result.current.currentPage).toBe(3);
    expect(onPageChange).toHaveBeenCalledTimes(1);
    expect(onPageChange).toHaveBeenLastCalledWith(3);
  });
});
