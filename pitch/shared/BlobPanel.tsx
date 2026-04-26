import type { HTMLAttributes, ReactNode } from 'react'
import { useWobbly } from './useWobbly'
import './BlobPanel.css'

interface BlobPanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function BlobPanel({
  className = '',
  children,
  style,
  ...rest
}: BlobPanelProps) {
  const wobblyRef = useWobbly('panel')
  const classes = ['blob-panel', className].filter(Boolean).join(' ')

  return (
    <div className="blob-panel-wrap" style={style} {...rest}>
      <div ref={wobblyRef} className={classes}>
        {children}
      </div>
    </div>
  )
}
