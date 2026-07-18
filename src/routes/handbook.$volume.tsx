import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/handbook/$volume")({
  component: () => <Outlet />,
});
