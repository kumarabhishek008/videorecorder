import type { SVGProps } from 'react'

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props,
})

type P = SVGProps<SVGSVGElement>
export const IconScreen = (p: P) => (<svg {...base(p)}><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>)
export const IconCamera = (p: P) => (<svg {...base(p)}><path d="M15 10l5-3v10l-5-3z" /><rect x="2" y="6" width="13" height="12" rx="2" /></svg>)
export const IconCameraOff = (p: P) => (<svg {...base(p)}><path d="M15 10l5-3v10l-5-3zM2 2l20 20M13 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1m4 0h4a2 2 0 0 1 2 2v4" /></svg>)
export const IconMic = (p: P) => (<svg {...base(p)}><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v4" /></svg>)
export const IconMicOff = (p: P) => (<svg {...base(p)}><path d="M2 2l20 20M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11.9 5M19 11a7 7 0 0 1-.7 3M12 18v4" /></svg>)
export const IconScreenCam = (p: P) => (<svg {...base(p)}><rect x="2" y="4" width="20" height="13" rx="2" /><circle cx="17" cy="13" r="3" /><path d="M8 21h8" /></svg>)
export const IconWave = (p: P) => (<svg {...base(p)}><path d="M2 12h2M6 8v8M10 4v16M14 7v10M18 10v4M22 12h0" /></svg>)
export const IconPause = (p: P) => (<svg {...base(p)}><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>)
export const IconPlay = (p: P) => (<svg {...base(p)}><path d="M7 4l13 8-13 8z" /></svg>)
export const IconStop = (p: P) => (<svg {...base(p)}><rect x="6" y="6" width="12" height="12" rx="2" /></svg>)
export const IconRestart = (p: P) => (<svg {...base(p)}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>)
export const IconTrash = (p: P) => (<svg {...base(p)}><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>)
export const IconPen = (p: P) => (<svg {...base(p)}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>)
export const IconPopout = (p: P) => (<svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="2" /><rect x="12" y="12" width="7" height="6" rx="1" /></svg>)
export const IconDownload = (p: P) => (<svg {...base(p)}><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></svg>)
export const IconFolder = (p: P) => (<svg {...base(p)}><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>)
export const IconSave = (p: P) => (<svg {...base(p)}><path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M7 3v5h8M7 21v-7h10v7" /></svg>)
export const IconImage = (p: P) => (<svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></svg>)
export const IconScissors = (p: P) => (<svg {...base(p)}><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" /></svg>)
export const IconLibrary = (p: P) => (<svg {...base(p)}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>)
export const IconPlus = (p: P) => (<svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>)
export const IconX = (p: P) => (<svg {...base(p)}><path d="M18 6L6 18M6 6l12 12" /></svg>)
export const IconShape = (p: P) => (<svg {...base(p)}><circle cx="8" cy="8" r="5" /><rect x="11" y="11" width="10" height="10" rx="2" /></svg>)
