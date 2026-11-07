import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { IconCheck, IconChevronDown } from './Icons'

interface Props<T extends string> {
  value: T
  options: [T, string][]
  onChange: (v: T) => void
  id?: string
  className?: string
  disabled?: boolean
  /** Name for a dropdown without a visible label. */
  label?: string
  labelledBy?: string
  title?: string
}

const GAP = 6
const EDGE = 8
const MENU_MAX_HEIGHT = 280
const MENU_MIN_WIDTH = 96
const TYPE_AHEAD_MS = 600

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Dropdown with our own menu, since browsers don't let a native select's list be styled. */
export function Select<T extends string>({ value, options, onChange, id, className = '', disabled, label, labelledBy, title }: Props<T>) {
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLUListElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [place, setPlace] = useState<CSSProperties>({ visibility: 'hidden' })

  const selected = Math.max(0, options.findIndex(([v]) => v === value))

  const show = () => {
    setActive(selected)
    setPlace({ visibility: 'hidden' })
    setOpen(true)
  }
  const pick = (i: number) => {
    onChange(options[i][0])
    setOpen(false)
  }

  // Fixed to the window so scrolling panels and the player can't clip it; flips up when there's no room below.
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return
    const r = trigger.current.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - GAP - EDGE
    const above = r.top - GAP - EDGE
    const wanted = Math.min(menu.current.scrollHeight + 2, MENU_MAX_HEIGHT)
    const up = wanted > below && above > below
    const width = Math.max(r.width, MENU_MIN_WIDTH)
    setPlace({
      left: clamp(r.left, EDGE, window.innerWidth - width - EDGE),
      width,
      maxHeight: Math.min(MENU_MAX_HEIGHT, up ? above : below),
      ...(up ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
    })
  }, [open])

  useEffect(() => {
    // Moves only the menu: scrollIntoView could also scroll the panel behind it, which closes the menu.
    const list = menu.current
    const item = list?.children[active] as HTMLElement | undefined
    if (!open || !list || !item) return
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight
  }, [open, active])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) close()
    }
    const onScroll = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const typeAhead = (key: string) => {
    const now = performance.now()
    const text = (now - typed.current.at < TYPE_AHEAD_MS ? typed.current.text : '') + key.toLowerCase()
    typed.current = { text, at: now }
    const match = options.findIndex(([, l]) => l.toLowerCase().startsWith(text))
    if (match >= 0) setActive(match)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1
    const handlers: Record<string, () => void> = open
      ? {
          ArrowDown: () => setActive((a) => Math.min(last, a + 1)),
          ArrowUp: () => setActive((a) => Math.max(0, a - 1)),
          Home: () => setActive(0),
          End: () => setActive(last),
          Enter: () => pick(active),
          ' ': () => pick(active),
          Escape: () => setOpen(false),
        }
      : { ArrowDown: show, ArrowUp: show, Enter: show, ' ': show }
    const fn = handlers[e.key]
    if (fn) {
      // Keeps these keys from also reaching the player's and recorder's shortcuts.
      e.preventDefault()
      e.stopPropagation()
      fn()
    } else if (open && e.key === 'Tab') {
      setOpen(false)
    } else if (open && e.key.length === 1) {
      e.stopPropagation()
      typeAhead(e.key)
    }
  }

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        className={`select ${className}`}
        disabled={disabled}
        title={title}
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">{options[selected]?.[1]}</span>
        <IconChevronDown className="select-arrow" aria-hidden />
      </button>
      {open && (
        <ul ref={menu} id={listId} role="listbox" className="select-menu" style={place} aria-label={label} aria-labelledby={labelledBy} onMouseDown={(e) => e.preventDefault()}>
          {options.map(([v, l], i) => (
            <li
              key={v}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === selected}
              className={`select-option ${i === active ? 'select-option-active' : ''}`}
              onPointerMove={() => setActive(i)}
              onClick={() => pick(i)}
            >
              <span>{l}</span>
              {i === selected && <IconCheck aria-hidden />}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
