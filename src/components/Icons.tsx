// App icons, from the Lucide icon library (lucide.dev). Names are kept so screens don't change.
import {
  AudioLines,
  Blend,
  Check,
  ChevronDown,
  Clapperboard,
  FastForward,
  Focus,
  Folder,
  Image,
  Layers,
  LayoutGrid,
  Maximize,
  Mic,
  MicOff,
  Minimize,
  Monitor,
  MonitorPlay,
  Moon,
  MousePointerClick,
  Palette,
  Pause,
  PenLine,
  PictureInPicture2,
  Play,
  Plus,
  Redo2,
  Rewind,
  RotateCcw,
  Save,
  Scaling,
  ScanSearch,
  Scissors,
  Shapes,
  SkipBack,
  SkipForward,
  Sparkles,
  Square,
  SquareSplitHorizontal,
  Sun,
  SwitchCamera,
  Trash2,
  Type,
  Undo2,
  Upload,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  Download,
  X,
  ZoomIn,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react'

function wrap(C: LucideIcon, name: string) {
  const Icon = (p: LucideProps) => <C size={20} strokeWidth={1.75} aria-hidden {...p} />
  Icon.displayName = name
  return Icon
}

export const IconScreen = wrap(Monitor, 'IconScreen')
export const IconCamera = wrap(Video, 'IconCamera')
export const IconCameraOff = wrap(VideoOff, 'IconCameraOff')
export const IconMic = wrap(Mic, 'IconMic')
export const IconMicOff = wrap(MicOff, 'IconMicOff')
export const IconScreenCam = wrap(MonitorPlay, 'IconScreenCam')
export const IconWave = wrap(AudioLines, 'IconWave')
export const IconPause = wrap(Pause, 'IconPause')
export const IconChevronDown = wrap(ChevronDown, 'IconChevronDown')
export const IconCheck = wrap(Check, 'IconCheck')
export const IconPlay = wrap(Play, 'IconPlay')
export const IconStop = wrap(Square, 'IconStop')
export const IconRestart = wrap(RotateCcw, 'IconRestart')
export const IconTrash = wrap(Trash2, 'IconTrash')
export const IconPen = wrap(PenLine, 'IconPen')
export const IconPopout = wrap(PictureInPicture2, 'IconPopout')
export const IconDownload = wrap(Download, 'IconDownload')
export const IconFolder = wrap(Folder, 'IconFolder')
export const IconSave = wrap(Save, 'IconSave')
export const IconImage = wrap(Image, 'IconImage')
export const IconScissors = wrap(Scissors, 'IconScissors')
export const IconLibrary = wrap(LayoutGrid, 'IconLibrary')
export const IconPlus = wrap(Plus, 'IconPlus')
export const IconX = wrap(X, 'IconX')
export const IconShape = wrap(Shapes, 'IconShape')
export const IconZoom = wrap(ZoomIn, 'IconZoom')
export const IconSpotlight = wrap(Focus, 'IconSpotlight')
export const IconClick = wrap(MousePointerClick, 'IconClick')
export const IconSun = wrap(Sun, 'IconSun')
export const IconMoon = wrap(Moon, 'IconMoon')
export const IconFlip = wrap(SwitchCamera, 'IconFlip')
export const IconVolume = wrap(Volume2, 'IconVolume')
export const IconVolumeOff = wrap(VolumeX, 'IconVolumeOff')
export const IconFullscreen = wrap(Maximize, 'IconFullscreen')
export const IconFullscreenExit = wrap(Minimize, 'IconFullscreenExit')
export const IconBack5 = wrap(Rewind, 'IconBack5')
export const IconForward5 = wrap(FastForward, 'IconForward5')
export const IconResize = wrap(Scaling, 'IconResize')
export const IconObjects = wrap(ScanSearch, 'IconObjects')
export const IconEdit = wrap(Clapperboard, 'IconEdit')
export const IconSplit = wrap(SquareSplitHorizontal, 'IconSplit')
export const IconUndo = wrap(Undo2, 'IconUndo')
export const IconRedo = wrap(Redo2, 'IconRedo')
export const IconText = wrap(Type, 'IconText')
export const IconMagic = wrap(Sparkles, 'IconMagic')
export const IconLayers = wrap(Layers, 'IconLayers')
export const IconExport = wrap(Upload, 'IconExport')
export const IconSkipStart = wrap(SkipBack, 'IconSkipStart')
export const IconSkipEnd = wrap(SkipForward, 'IconSkipEnd')
export const IconPalette = wrap(Palette, 'IconPalette')
export const IconTransition = wrap(Blend, 'IconTransition')
