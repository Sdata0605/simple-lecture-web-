import { Suspense } from "react";
import type { ComponentProps } from "react";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

// The homepage hero only renders this player on mobile. Loading it lazily keeps
// the learning-player code (video stage, pickers, notes) out of the homepage's
// initial JavaScript. The placeholder reserves the same minimum height as the
// player so the layout does not jump when it loads.
const HeroLecturePlayerImpl = lazyWithRetry(() =>
  import("@/components/HeroLecturePlayer").then((m) => ({ default: m.HeroLecturePlayer }))
);

type Props = ComponentProps<typeof import("@/components/HeroLecturePlayer").HeroLecturePlayer>;

export const LazyHeroLecturePlayer = (props: Props) => (
  <Suspense
    fallback={
      <div className="w-full mx-auto max-w-full mt-8 min-h-[300px]" aria-hidden="true" />
    }
  >
    <HeroLecturePlayerImpl {...props} />
  </Suspense>
);

export default LazyHeroLecturePlayer;
