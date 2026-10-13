import type { Meta, StoryObj } from "@storybook/react";
import {
  HeroWorkspace,
  FeatureMini,
  AuthSideArt,
  EmptyTable,
  BlogHero,
  DoodleBackground,
  WorkspaceHeaderArt,
  BlogCardAccent,
  BlogCover,
  CommandLayerArt,
  FeatureScene,
} from "./index";
import type { BlogCoverId } from "./BlogCover";

const meta: Meta = {
  title: "Illustrations/Notion",
  parameters: { layout: "padded" },
};
export default meta;

export const Hero: StoryObj = {
  render: () => (
    <div className="rounded-2xl bg-[#F7F6F3] p-6">
      <HeroWorkspace className="w-full max-w-2xl" />
    </div>
  ),
};

export const FeatureVariants: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      {(["table", "kanban", "ai", "members", "auth", "spark"] as const).map((v) => (
        <div key={v} className="space-y-2">
          <FeatureMini variant={v} className="w-40" />
          <p className="text-center text-xs text-[#9B9A97]">{v}</p>
        </div>
      ))}
    </div>
  ),
};

export const AuthSide: StoryObj = {
  render: () => (
    <AuthSideArt className="h-[28rem] w-72 overflow-hidden rounded-2xl shadow-[0_8px_24px_rgba(55,53,47,0.08)]" />
  ),
};

export const Empty: StoryObj = {
  render: () => (
    <div className="flex flex-col items-center rounded-2xl border border-[#E3E2DE] bg-white p-10">
      <EmptyTable className="w-72" />
      <p className="mt-4 text-sm text-[#9B9A97]">选择或新建一张表</p>
    </div>
  ),
};

export const Blog: StoryObj = {
  render: () => <BlogHero className="w-96" />,
};

export const BlogCards: StoryObj = {
  render: () => (
    <div className="flex gap-3">
      {[0, 1, 2, 3, 4].map((i) => (
        <BlogCardAccent key={i} index={i} className="h-20 w-20" />
      ))}
    </div>
  ),
};

export const WorkspaceChrome: StoryObj = {
  render: () => <WorkspaceHeaderArt className="w-40" />,
};

export const Doodles: StoryObj = {
  render: () => <DoodleBackground className="h-48 w-full rounded-2xl" />,
};


const coverIds: BlogCoverId[] = [
  "same-command-layer",
  "ai-native-tables",
  "100k-rows-keyset",
  "notion-style-workspace",
  "multi-harness-chat",
  "mcp-five-minutes",
];

export const BlogCovers: StoryObj = {
  render: () => (
    <div className="grid gap-4 sm:grid-cols-2">
      {coverIds.map((id) => (
        <div key={id} className="space-y-2">
          <div className="overflow-hidden rounded-2xl border border-[#E3E2DE] bg-[#F7F6F3]">
            <BlogCover id={id} className="aspect-[16/9] w-full" />
          </div>
          <p className="text-center text-xs text-[#9B9A97]">{id}</p>
        </div>
      ))}
    </div>
  ),
};


export const CommandLayer: StoryObj = {
  render: () => (
    <div className="rounded-2xl bg-[#F7F6F3] p-6">
      <CommandLayerArt className="w-full max-w-4xl" />
    </div>
  ),
};

export const FeatureScenes: StoryObj = {
  render: () => (
    <div className="grid gap-6">
      {(["table", "kanban", "agents"] as const).map((v) => (
        <div key={v} className="rounded-2xl border border-[#E3E2DE] bg-[#F7F6F3] p-4">
          <FeatureScene variant={v} className="w-full max-w-lg" />
          <p className="mt-2 text-center text-xs text-[#9B9A97]">{v}</p>
        </div>
      ))}
    </div>
  ),
};
