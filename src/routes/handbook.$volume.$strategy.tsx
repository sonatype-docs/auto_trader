import { createFileRoute, notFound } from "@tanstack/react-router";
import { findStrategy } from "@/lib/handbook/registry";
import { StrategyPage, defaultStubSections } from "@/components/handbook/strategy-page";
import { LONDON_ORB_SECTIONS } from "@/content/handbook/london-orb";
import { LondonOrbBacktester } from "@/components/handbook/london-orb-backtester";

export const Route = createFileRoute("/handbook/$volume/$strategy")({
  component: StrategyRoute,
  loader: ({ params }) => {
    const found = findStrategy(params.volume, params.strategy);
    if (!found) throw notFound();
    return found;
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          {
            title: `${loaderData.strategy.title} — Vol ${loaderData.volume.number} · XAU/USD Handbook`,
          },
          { name: "description", content: loaderData.strategy.subtitle },
          {
            property: "og:title",
            content: `${loaderData.strategy.title} · XAU/USD Handbook`,
          },
          { property: "og:description", content: loaderData.strategy.subtitle },
        ]
      : [{ title: "Strategy — Handbook" }],
  }),
});

function StrategyRoute() {
  const { volume, strategy } = Route.useLoaderData();

  if (volume.slug === "v1" && strategy.slug === "london-orb") {
    return (
      <StrategyPage
        volume={volume}
        strategy={strategy}
        sections={LONDON_ORB_SECTIONS}
        liveBacktester={<LondonOrbBacktester />}
        status="full"
      />
    );
  }

  return (
    <StrategyPage
      volume={volume}
      strategy={strategy}
      sections={defaultStubSections(strategy.title)}
      status="stub"
    />
  );
}
