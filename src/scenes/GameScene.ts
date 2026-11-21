import Phaser from 'phaser';
import { advancePlayer, type PlayerState } from '../game/player';

export class GameScene extends Phaser.Scene {
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | undefined;
  private player?: Phaser.GameObjects.Arc;
  private state: PlayerState = {
    position: { x: 400, y: 300 },
    speed: 240,
    radius: 18,
  };

  constructor() {
    super('game');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#101426');
    this.add
      .text(24, 20, 'Secure Phaser Template', {
        color: '#f5f7ff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '24px',
      })
      .setScrollFactor(0);
    this.add
      .text(24, 56, 'Move with arrow keys', {
        color: '#8ea0c9',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '16px',
      })
      .setScrollFactor(0);

    this.player = this.add.circle(
      this.state.position.x,
      this.state.position.y,
      this.state.radius,
      0x55ddee,
    );
    this.cursors = this.input.keyboard?.createCursorKeys();
  }

  update(_time: number, delta: number): void {
    if (!this.cursors || !this.player) {
      return;
    }

    const input = {
      x: Number(this.cursors.right.isDown) - Number(this.cursors.left.isDown),
      y: Number(this.cursors.down.isDown) - Number(this.cursors.up.isDown),
    };

    this.state = advancePlayer(this.state, input, delta / 1000, {
      width: this.scale.width,
      height: this.scale.height,
    });
    this.player.setPosition(this.state.position.x, this.state.position.y);
  }
}
