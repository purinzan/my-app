import { useCallback, useEffect, useMemo, useState } from "react";

type UsePaginationOptions = {
  totalItems: number;
  pageSize: number;
  initialPage?: number;
  onPageChange?: (page: number) => void;
};

type UsePaginationResult = {
  currentPage: number;
  totalPages: number;
  goToPage: (page: number) => void;
  goToNextPage: () => void;
  goToPreviousPage: () => void;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

export function usePagination({
  totalItems,
  pageSize,
  initialPage = 1,
  onPageChange,
}: UsePaginationOptions): UsePaginationResult {
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(totalItems / pageSize)),
    [pageSize, totalItems],
  );

  const clampPage = useCallback(
    (page: number) => Math.min(Math.max(page, 1), totalPages),
    [totalPages],
  );

  const [currentPage, setCurrentPage] = useState(() => clampPage(initialPage));

  const goToPage = useCallback(
    (page: number) => {
      setCurrentPage((previousPage) => {
        const nextPage = clampPage(page);
        return previousPage === nextPage ? previousPage : nextPage;
      });
    },
    [clampPage],
  );

  const goToNextPage = useCallback(() => {
    setCurrentPage((previousPage) => {
      const nextPage = clampPage(previousPage + 1);
      return previousPage === nextPage ? previousPage : nextPage;
    });
  }, [clampPage]);

  const goToPreviousPage = useCallback(() => {
    setCurrentPage((previousPage) => {
      const nextPage = clampPage(previousPage - 1);
      return previousPage === nextPage ? previousPage : nextPage;
    });
  }, [clampPage]);

  useEffect(() => {
    setCurrentPage((previousPage) => clampPage(previousPage));
  }, [clampPage]);

  useEffect(() => {
    onPageChange?.(currentPage);
  }, [currentPage, onPageChange]);

  return {
    currentPage,
    totalPages,
    goToPage,
    goToNextPage,
    goToPreviousPage,
    hasNextPage: currentPage < totalPages,
    hasPreviousPage: currentPage > 1,
  };
}
