export default defineBackground({
  type: 'module',
  async main() {
    const { startBackground } = await import('../background/index');
    startBackground();
  },
});
