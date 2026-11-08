// Otaku glyphs that lucide has no icon for. Drawn on lucide's grid (24px, 2px stroke)
// and built with createLucideIcon, so they take the same props as lucide icons.
// Source artwork: the approved mobile mocks (design/icons/*.svg).
import { createLucideIcon, type IconNode } from 'lucide-react'

const EpisodesNode: IconNode = [["rect", {"x": "2", "y": "7", "width": "15", "height": "12", "rx": "2", "key": "episodes-0"}], ["path", {"d": "M6 4h13a2 2 0 0 1 2 2v9", "key": "episodes-1"}], ["path", {"d": "m8 10.5 4 2.5-4 2.5z", "key": "episodes-2"}]]
export const Episodes = createLucideIcon('otaku-episodes', EpisodesNode)

const LockControlsNode: IconNode = [["rect", {"x": "5", "y": "11", "width": "14", "height": "10", "rx": "2", "key": "lock-controls-0"}], ["path", {"d": "M8 11V7a4 4 0 0 1 8 0v4", "key": "lock-controls-1"}], ["circle", {"cx": "12", "cy": "16", "r": "1", "key": "lock-controls-2"}]]
export const LockControls = createLucideIcon('otaku-lock-controls', LockControlsNode)

const PairMacNode: IconNode = [["rect", {"x": "4", "y": "4", "width": "16", "height": "12", "rx": "2", "key": "pair-mac-0"}], ["path", {"d": "M2 20h20", "key": "pair-mac-1"}], ["path", {"d": "m9 10 2 2 4-4", "key": "pair-mac-2"}]]
export const PairMac = createLucideIcon('otaku-pair-mac', PairMacNode)

const ReaderDoubleNode: IconNode = [["path", {"d": "M12 6c-2-1.3-5-2-9-2v15c4 0 7 .7 9 2 2-1.3 5-2 9-2V4c-4 0-7 .7-9 2z", "key": "reader-double-0"}], ["path", {"d": "M12 6v15", "key": "reader-double-1"}]]
export const ReaderDouble = createLucideIcon('otaku-reader-double', ReaderDoubleNode)

const ReaderPagedLtrNode: IconNode = [["rect", {"x": "3", "y": "4", "width": "8", "height": "16", "rx": "1.5", "key": "reader-paged-ltr-0"}], ["rect", {"x": "13", "y": "4", "width": "8", "height": "16", "rx": "1.5", "opacity": ".45", "key": "reader-paged-ltr-1"}], ["path", {"d": "M15 12h4m-1.5-1.5L19 12l-1.5 1.5", "key": "reader-paged-ltr-2"}]]
export const ReaderPagedLtr = createLucideIcon('otaku-reader-paged-ltr', ReaderPagedLtrNode)

const ReaderPagedRtlNode: IconNode = [["rect", {"x": "3", "y": "4", "width": "8", "height": "16", "rx": "1.5", "opacity": ".45", "key": "reader-paged-rtl-0"}], ["rect", {"x": "13", "y": "4", "width": "8", "height": "16", "rx": "1.5", "key": "reader-paged-rtl-1"}], ["path", {"d": "M9 12H5m1.5-1.5L5 12l1.5 1.5", "key": "reader-paged-rtl-2"}]]
export const ReaderPagedRtl = createLucideIcon('otaku-reader-paged-rtl', ReaderPagedRtlNode)

const ReaderWebtoonNode: IconNode = [["rect", {"x": "7", "y": "2", "width": "10", "height": "20", "rx": "1.5", "key": "reader-webtoon-0"}], ["path", {"d": "M7 9h10M7 15h10", "key": "reader-webtoon-1"}], ["path", {"d": "m10 18.5 2 1.5 2-1.5", "opacity": ".7", "key": "reader-webtoon-2"}]]
export const ReaderWebtoon = createLucideIcon('otaku-reader-webtoon', ReaderWebtoonNode)

const ReleaseRadarNode: IconNode = [["circle", {"cx": "12", "cy": "12", "r": "2", "key": "release-radar-0"}], ["path", {"d": "M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4", "key": "release-radar-1"}], ["path", {"d": "M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2", "key": "release-radar-2"}]]
export const ReleaseRadar = createLucideIcon('otaku-release-radar', ReleaseRadarNode)

const SeekBack10Node: IconNode = [["path", {"d": "M3 12a9 9 0 1 0 3-6.7L3 8", "key": "seek-back-10-0"}], ["path", {"d": "M3 3v5h5", "key": "seek-back-10-1"}], ["path", {"d": "M10 9.5v5", "key": "seek-back-10-2"}], ["rect", {"x": "12.5", "y": "9.5", "width": "3.5", "height": "5", "rx": "1.75", "key": "seek-back-10-3"}]]
export const SeekBack10 = createLucideIcon('otaku-seek-back-10', SeekBack10Node)

const SeekFwd10Node: IconNode = [["path", {"d": "M21 12a9 9 0 1 1-3-6.7L21 8", "key": "seek-fwd-10-0"}], ["path", {"d": "M21 3v5h-5", "key": "seek-fwd-10-1"}], ["path", {"d": "M8.5 9.5v5", "key": "seek-fwd-10-2"}], ["rect", {"x": "11", "y": "9.5", "width": "3.5", "height": "5", "rx": "1.75", "key": "seek-fwd-10-3"}]]
export const SeekFwd10 = createLucideIcon('otaku-seek-fwd-10', SeekFwd10Node)

const SkipIntroNode: IconNode = [["path", {"d": "m5 5 7 7-7 7", "key": "skip-intro-0"}], ["path", {"d": "m12 5 7 7-7 7", "key": "skip-intro-1"}], ["path", {"d": "M21 4v16", "key": "skip-intro-2"}]]
export const SkipIntro = createLucideIcon('otaku-skip-intro', SkipIntroNode)

const StatusPlanNode: IconNode = [["rect", {"x": "4", "y": "3", "width": "16", "height": "18", "rx": "2", "key": "status-plan-0"}], ["path", {"d": "M8 8h8M8 12h8M8 16h5", "key": "status-plan-1"}]]
export const StatusPlan = createLucideIcon('otaku-status-plan', StatusPlanNode)

const SubDubNode: IconNode = [["rect", {"x": "2", "y": "5", "width": "20", "height": "14", "rx": "2", "key": "sub-dub-0"}], ["path", {"d": "M6 10h5M6 14h3", "key": "sub-dub-1"}], ["path", {"d": "M14 14h4M13 10h5", "key": "sub-dub-2"}]]
export const SubDub = createLucideIcon('otaku-sub-dub', SubDubNode)
