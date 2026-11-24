import { Title } from '@solidjs/meta';
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab, TabsTabIcon } from '@ui-sdk/solid/tabs';
import { Columns3, Layers } from 'lucide';

import LucideIcon from '../components/LucideIcon';
import RecentBoardsList from '../components/RecentBoardsList';
import PokerSnapshot from '../components/home/PokerSnapshot';
import RetroSnapshot from '../components/home/RetroSnapshot';
import '../components/home/home.css';
import RecentPokerRoomsList from '../components/poker/RecentPokerRoomsList';
import { pokerSetupPath } from '../lib/poker-routes';
import { retroSetupPath } from '../lib/routes';

const setupLinkClass =
  'spring-press board-focus-ring inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-accent px-6 py-2.5 text-[15px] leading-none font-semibold text-accent-contrast hover:opacity-92 sm:w-fit sm:min-w-48';

const tabClass = [
  'home-tool-tab board-focus-ring relative z-10 inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[14px] leading-none font-semibold tracking-[-0.015em] whitespace-nowrap text-text-muted transition-colors hover:text-text data-selected:text-text min-[375px]:text-[15px] sm:min-h-[3.25rem] sm:gap-2.5 sm:px-7 sm:text-base',
];

export default function Home() {
  return (
    <main class="mx-auto max-w-4xl px-4 pt-6 pb-12 sm:px-6 sm:pt-10 sm:pb-16 lg:pt-12 lg:pb-20">
      <Title>Retrocks — Sprint Retrospectives &amp; Pointing Poker</Title>

      <h1 class="text-center text-[2rem] leading-[1.08] font-semibold tracking-[-0.035em] text-balance lg:text-[2.75rem]">
        The Sprint rituals.
      </h1>

      <Tabs defaultValue="retro" hiddenUntilFound class="home-stage mt-7 sm:mt-9">
        <div class="flex justify-center">
          <TabsList
            aria-label="Retrocks tools"
            class="home-tabs-track relative grid w-full max-w-lg grid-cols-2 rounded-2xl p-1.5"
          >
            <TabsIndicator class="home-tabs-indicator rounded-xl" />

            <TabsTab value="retro" class={tabClass}>
              <TabsTabIcon class="home-tool-tab-icon inline-flex shrink-0">
                <LucideIcon icon={Columns3} class="size-4.5" strokeWidth={2} />
              </TabsTabIcon>
              <span>Retro</span>
            </TabsTab>

            <TabsTab value="poker" class={tabClass}>
              <TabsTabIcon class="home-tool-tab-icon inline-flex shrink-0">
                <LucideIcon icon={Layers} class="size-4.5" strokeWidth={2} />
              </TabsTabIcon>
              <span>Poker</span>
            </TabsTab>
          </TabsList>
        </div>

        <div class="home-tab-panels mt-7 sm:mt-9">
          <TabsPanel value="retro" class="home-tab-panel">
            <div class="home-stage-inner grid gap-6 sm:gap-7">
              <RetroSnapshot />
              <div class="flex justify-center">
                <a href={retroSetupPath} class={setupLinkClass}>
                  Create a Board
                </a>
              </div>
              <div class="mt-4 empty:hidden sm:mt-6">
                <RecentBoardsList />
              </div>
            </div>
          </TabsPanel>

          <TabsPanel value="poker" class="home-tab-panel">
            <div class="home-stage-inner grid gap-6 sm:gap-7">
              <PokerSnapshot />
              <div class="flex justify-center">
                <a href={pokerSetupPath} class={setupLinkClass}>
                  Create a Room
                </a>
              </div>
              <div class="mt-4 empty:hidden sm:mt-6">
                <RecentPokerRoomsList />
              </div>
            </div>
          </TabsPanel>
        </div>
      </Tabs>

      <footer class="mt-12 border-t border-border/70 pt-5 text-center text-[13px] leading-relaxed text-text-muted sm:mt-16">
        No accounts or tracking. Boards and Rooms are shared by link and expire automatically.
      </footer>
    </main>
  );
}
