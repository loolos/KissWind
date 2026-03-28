import Phaser from 'phaser'
import { BootScene } from './scenes/BootScene'
import { GameScene } from './scenes/GameScene'

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  backgroundColor: '#0a2040',
  scene: [BootScene, GameScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight,
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

new Phaser.Game(config)
