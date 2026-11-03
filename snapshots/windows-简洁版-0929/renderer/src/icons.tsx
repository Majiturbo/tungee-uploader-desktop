import type { CSSProperties } from "react";
import {
  ArrowClockwise20Regular,
  ArrowImport20Regular,
  ArrowLeft20Regular,
  CheckmarkCircle20Filled,
  CheckmarkCircle20Regular,
  Checkmark20Regular,
  CloudArrowUp20Regular,
  Copy20Regular,
  Delete20Regular,
  Dismiss20Regular,
  DocumentArrowDown20Regular,
  DocumentSearch20Regular,
  DocumentTable20Regular,
  ErrorCircle20Filled,
  FolderOpen20Regular,
  HardDrive20Regular,
  HeadphonesSoundWave20Regular,
  Info20Filled,
  Next20Regular,
  PanelRight20Regular,
  Play20Regular,
  Settings20Regular,
  Sparkle20Regular,
  Stop20Regular,
  Target20Regular,
  TaskListLtr20Regular,
  TextGrammarCheckmark20Regular,
  Wand20Regular,
  Warning20Filled,
  Warning20Regular,
  type FluentIcon,
} from "@fluentui/react-icons";

interface IconProps {
  size?: number;
  className?: string;
  fill?: string;
  strokeWidth?: number;
}

function icon(Glyph: FluentIcon) {
  return function Icon({ size = 16, className }: IconProps) {
    const style: CSSProperties = { width: size, height: size, flex: "none" };
    return <Glyph className={className} style={style} aria-hidden />;
  };
}

export function LoaderCircle({ size = 16, className }: IconProps) {
  return <span className={`progress-ring ${className ?? ""}`} style={{ width: size, height: size }} role="progressbar" aria-label="处理中" />;
}

export const AlertTriangle = icon(Warning20Regular);
export const ArrowLeft = icon(ArrowLeft20Regular);
export const AudioLines = icon(HeadphonesSoundWave20Regular);
export const Check = icon(Checkmark20Regular);
export const CheckCircle2 = icon(CheckmarkCircle20Regular);
export const Copy = icon(Copy20Regular);
export const FileDown = icon(DocumentArrowDown20Regular);
export const HardDrive = icon(HardDrive20Regular);
export const ListChecks = icon(TaskListLtr20Regular);
export const Play = icon(Play20Regular);
export const RefreshCw = icon(ArrowClockwise20Regular);
export const SkipForward = icon(Next20Regular);
export const Sparkles = icon(Sparkle20Regular);
export const Stethoscope = icon(TextGrammarCheckmark20Regular);
export const Target = icon(Target20Regular);
export const Trash2 = icon(Delete20Regular);
export const Wand2 = icon(Wand20Regular);
export const X = icon(Dismiss20Regular);

export const ImportIcon = icon(ArrowImport20Regular);
export const CheckupIcon = icon(DocumentSearch20Regular);
export const UploadIcon = icon(CloudArrowUp20Regular);
export const WorkbookIcon = icon(DocumentTable20Regular);
export const FolderIcon = icon(FolderOpen20Regular);
export const SettingsIcon = icon(Settings20Regular);
export const PaneIcon = icon(PanelRight20Regular);
export const StopIcon = icon(Stop20Regular);
export const SuccessIcon = icon(CheckmarkCircle20Filled);
export const ErrorIcon = icon(ErrorCircle20Filled);
export const WarningIcon = icon(Warning20Filled);
export const InfoIcon = icon(Info20Filled);
