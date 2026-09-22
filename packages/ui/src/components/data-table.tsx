"use client";

import {
  columnSizingFeature,
  columnVisibilityFeature,
  createSortedRowModel,
  flexRender,
  type RowData,
  rowSortingFeature,
  type SortingState,
  type ColumnDef as TableColumnDef,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "../lib/cn";
import { Skeleton } from "./skeleton";

/**
 * Fonctionnalités activées pour toutes les tables du panel.
 *
 * TanStack Table v9 n'embarque plus rien par défaut : chaque capacité et son
 * modèle de lignes doivent être déclarés, ce qui permet d'écarter du bundle ce
 * que l'on n'utilise pas. Ce jeu est constant, donc défini hors du rendu.
 */
const FEATURES = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  // Largeur de colonne déclarée par `size`, et cellules visibles par ligne.
  columnSizingFeature,
  columnVisibilityFeature,
});

/** Définition de colonne liée au jeu de fonctionnalités ci-dessus. */
export type ColumnDef<TData extends RowData, TValue = unknown> = TableColumnDef<
  typeof FEATURES,
  TData,
  TValue
>;

export interface DataTableProps<T extends RowData> {
  columns: ColumnDef<T>[];
  data: T[] | undefined;
  isLoading?: boolean;
  emptyState?: ReactNode;
  onRowClick?: (row: T) => void;
  getRowId?: (row: T, index: number) => string;
  skeletonRows?: number;
  className?: string;
}

/**
 * Tableau générique : en-tête capitales gris, tri, lignes cliquables,
 * états loading (skeleton) et vide. Une seule implémentation pour toutes les listes.
 */
export function DataTable<T extends RowData>({
  columns,
  data,
  isLoading,
  emptyState,
  onRowClick,
  getRowId,
  skeletonRows = 4,
  className,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);

  // Les génériques sont explicites : sans eux, `useTable` retombe sur les
  // types par défaut et perd le type des lignes.
  const table = useTable<typeof FEATURES, T>({
    features: FEATURES,
    data: data ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId,
  });

  const rows = table.getRowModel().rows;

  return (
    <div
      className={cn(
        "overflow-x-auto rounded-card border border-border bg-surface shadow-card",
        className,
      )}
    >
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead className="bg-surface-2/60">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const direction = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    className={cn(
                      "px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted",
                      canSort && "cursor-pointer select-none hover:text-fg",
                    )}
                    style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                    onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {canSort ? (
                        direction === "asc" ? (
                          <ArrowUp className="size-3" />
                        ) : direction === "desc" ? (
                          <ArrowDown className="size-3" />
                        ) : (
                          <ArrowUpDown className="size-3 opacity-40" />
                        )
                      ) : null}
                    </span>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {isLoading ? (
            Array.from({ length: skeletonRows }).map((_, rowIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: squelette
              <tr key={rowIndex} className="border-t border-border">
                {columns.map((_, cellIndex) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: squelette
                  <td key={cellIndex} className="px-5 py-4">
                    <Skeleton className="h-4 w-3/4" />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>{emptyState}</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={cn(
                  "border-t border-border transition-colors",
                  onRowClick && "cursor-pointer hover:bg-surface-2/60",
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-5 py-4 align-middle">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
