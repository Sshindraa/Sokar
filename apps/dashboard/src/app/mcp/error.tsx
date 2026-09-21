'use client';

import { RouteErrorState } from '@/components/RouteErrorState';

/** Boundary d'erreur de la page MCP OAuth (`/mcp`). */
export default function McpError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorState error={error} reset={reset} scope="mcp" />;
}
