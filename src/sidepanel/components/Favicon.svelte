<script lang="ts">
import { faviconUrl } from '../../shared/favicon';

let { url, size = 16 }: { url: string; size?: number } = $props();

const src = $derived(faviconUrl(url, size));
// Remember which URL failed so a different page retries instead of staying on the glyph.
let failedFor: string | null = $state(null);
const showImg = $derived(src !== null && failedFor !== src);
</script>

<span class="icon" style:width="{size}px" style:height="{size}px" aria-hidden="true">
  {#if showImg && src}
    <img {src} width={size} height={size} alt="" loading="lazy" decoding="async" onerror={() => (failedFor = src)} />
  {:else}
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" stroke-width="1.2">
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" />
    </svg>
  {/if}
</span>

<style>
  .icon {
    flex: none;
    display: grid;
    place-items: center;
    color: var(--mOnSurfaceVariant);
  }

  img {
    display: block;
    border-radius: 3px;
  }
</style>
