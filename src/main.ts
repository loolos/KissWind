import Phaser from 'phaser'
import { BootScene } from './scenes/BootScene'
import { GameScene } from './scenes/GameScene'

const getViewportSize = (): { width: number; height: number } => {
  const vv = window.visualViewport
  if (vv) {
    return {
      width: Math.max(1, Math.round(vv.width)),
      height: Math.max(1, Math.round(vv.height)),
    }
  }
  return {
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight),
  }
}

const initialSize = getViewportSize()

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  backgroundColor: '#0a2040',
  scene: [BootScene, GameScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: initialSize.width,
    height: initialSize.height,
  },
  input: {
    touch: true,
    /** Two-finger pinch needs at least two simultaneous touch pointers. */
    activePointers: 3,
  },
  render: {
    preserveDrawingBuffer: true,
  },
  fps: {
    target: 60,
    smoothStep: true,
  },
}

const game = new Phaser.Game(config)

const resizeGameToViewport = (): void => {
  const { width, height } = getViewportSize()
  game.scale.resize(width, height)
}

window.addEventListener('resize', resizeGameToViewport)
window.visualViewport?.addEventListener('resize', resizeGameToViewport)
window.visualViewport?.addEventListener('scroll', resizeGameToViewport)
