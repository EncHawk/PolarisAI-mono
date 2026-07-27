'use client'

import { motion, useReducedMotion } from 'motion/react'

function PolarisWordmark() {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className="group inline-flex w-full cursor-default justify-center select-none"
      initial="idle"
      animate="idle"
      whileHover={reduce ? undefined : 'draw'}
    >
      <svg viewBox="0 0 1200 240" className="h-auto w-full min-h-[72px] sm:min-h-[100px] max-w-[1200px]" aria-label="POLARIS AI" role="img">
        <motion.text
          x="600"
          y="170"
          textAnchor="middle"
          fontFamily="'Space Grotesk', sans-serif"
          fontWeight={600}
          fontSize={190}
          letterSpacing="-6"
          stroke="var(--color-blue)"
          strokeWidth={1.4}
          strokeLinejoin="round"
          strokeLinecap="round"
          fill="var(--color-blue)"
          style={{ strokeDasharray: 3600 }}
          variants={{
            draw: {
              strokeDashoffset: [3600, 0],
              fillOpacity: [0, 0, 1],
              transition: { duration: 1.6, ease: 'easeInOut', times: [0, 0.55, 1] },
            },
            idle: {
              strokeDashoffset: 0,
              fillOpacity: 0,
              transition: { duration: 0.7, ease: 'easeOut' },
            },
          }}
        >
          POLARIS AI
        </motion.text>
      </svg>
    </motion.div>
  )
}

export function Footer() {
  return (
    <footer className="relative z-10 rounded-t-[2.5rem] bg-bg px-6 py-14 shadow-[0_-20px_60px_rgba(255,255,255,0.6)]">
      <div className="relative z-20 mx-auto flex w-full max-w-[1200px] flex-col items-center gap-8">
        <PolarisWordmark />
        <div className="flex flex-wrap items-center justify-center gap-8 font-mono text-xs text-text3">
          <a href="https://github.com/Polarisai-implementations" className="transition hover:text-blue" target="_blank" rel="noreferrer">GitHub</a>
          <a href="https://x.com/d_leap07" className="transition hover:text-blue" target="_blank" rel="noreferrer">X</a>
        </div>
        <span className="font-mono text-xs text-text4">© 2026 Polaris AI</span>
      </div>
    </footer>
  )
}
