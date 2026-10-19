import { startBackground } from '../background/index';

export default defineBackground({
  type: 'module',
  main: startBackground,
});
