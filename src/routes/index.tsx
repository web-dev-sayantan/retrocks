import { Title } from '@solidjs/meta';

import RecentBoardsList from '../components/RecentBoardsList';
import PokerSnapshot from '../components/home/PokerSnapshot';
import RetroSnapshot from '../components/home/RetroSnapshot';
import '../components/home/home.css';
import RecentPokerRoomsList from '../components/poker/RecentPokerRoomsList';
import { pokerSetupPath } from '../lib/poker-routes';
import { retroSetupPath } from '../lib/routes';

const setupLinkClass =
  'spring-press board-focus-ring inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-accent px-5 py-2.5 text-[15px] leading-none font-semibold text-accent-contrast hover:opacity-92 sm:w-fit sm:min-w-44';

export default function Home() {
  return (
    <main class="mx-auto max-w-6xl px-4 pt-6 pb-12 sm:px-6 sm:pt-10 sm:pb-16 lg:pt-12 lg:pb-20">
      <Title>Retrocks — Sprint Retrospectives &amp; Pointing Poker</Title>
      <h1 class="text-[2rem] leading-[1.08] font-semibold tracking-[-0.035em] text-balance lg:text-[2.75rem]">
        Sprint rituals, ready in a link.
      </h1>
      <p class="mt-3 max-w-[54ch] text-base leading-normal text-text-muted sm:text-[1.0625rem]">
        Retrospectives and pointing poker for agile teams. Share a link and start immediately without signing in.
      </p>

      <div class="home-diptych mt-8 grid gap-y-12 sm:mt-10 lg:grid-cols-2 lg:gap-x-10 lg:gap-y-0 xl:gap-x-12">
        <section aria-labelledby="tool-retro-heading" class="home-tool-bay">
          <RetroSnapshot />
          <h2 id="tool-retro-heading" class="text-xl leading-tight font-semibold tracking-[-0.02em]">
            Sprint Retrospectives
          </h2>
          <p class="max-w-[44ch] text-[15px] leading-relaxed text-text-muted">
            Collect anonymous Cards, group themes, vote together, and track Action Items on a shareable Board.
          </p>
          <a href={retroSetupPath} class={setupLinkClass}>Create a Board</a>
        </section>

        <section aria-labelledby="tool-poker-heading" class="home-tool-bay">
          <PokerSnapshot />
          <h2 id="tool-poker-heading" class="text-xl leading-tight font-semibold tracking-[-0.02em]">
            Pointing Poker
          </h2>
          <p class="max-w-[44ch] text-[15px] leading-relaxed text-text-muted">
            Estimate Stories together with private ballots, synchronized reveal, and recorded Accepted Estimates in a live Room.
          </p>
          <a href={pokerSetupPath} class={setupLinkClass}>Create a Room</a>
        </section>
      </div>

      <div class="mt-14 grid gap-6 empty:hidden sm:mt-16 lg:has-[>section+section]:grid-cols-2">
        <RecentBoardsList />
        <RecentPokerRoomsList />
      </div>

      <footer class="mt-12 border-t border-border/70 pt-5 text-[13px] leading-relaxed text-text-muted sm:mt-16">
        No accounts or tracking. Boards and Rooms are shared by link and expire automatically.
      </footer>
    </main>
  );
}
