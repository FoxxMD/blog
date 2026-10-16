// @ts-check
import { defineConfig } from 'astro/config'
import tailwindcss from '@tailwindcss/vite'
import sitemap from '@astrojs/sitemap'
import mdx from '@astrojs/mdx'
import { rehypeHeadingIds, unified } from '@astrojs/markdown-remark'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import remarkCustomHeaderId from 'remark-custom-header-id'
//import expressiveCode from 'astro-expressive-code'
import codeblocks from 'starlight-codeblocks/astro';
//import { pluginLink } from 'expressive-code-links'
import siteConfig from './src/site.config'
//import { pluginLineNumbers } from '@expressive-code/plugin-line-numbers'
//import { pluginCollapsible } from 'expressive-code-collapsible'
import remarkDescription from './src/plugins/remark-description'/* Add description to frontmatter */
import remarkReadingTime from './src/plugins/remark-reading-time'/* Add reading time to frontmatter */
import rehypeTitleFigure from './src/plugins/rehype-title-figure'/* Wraps titles in figures */
import { remarkGithubCard } from './src/plugins/remark-github-card'
import { fromHtmlIsomorphic } from 'hast-util-from-html-isomorphic'
import rehypeExternalLinks from 'rehype-external-links'
import remarkDirective from 'remark-directive'/* Handle ::: directives as nodes */
import rehypeUnwrapImages from 'rehype-unwrap-images'
import { remarkAdmonitions } from './src/plugins/remark-admonitions'/* Add admonitions */
import remarkCharacterDialogue from './src/plugins/remark-character-dialogue'/* Custom plugin to handle character admonitions */
import remarkUnknownDirectives from './src/plugins/remark-unknown-directives'/* Custom plugin to handle unknown admonitions */
import remarkMath from 'remark-math'/* for latex math support */
import rehypeKatex from 'rehype-katex'/* again, for latex math support */
import remarkGemoji from './src/plugins/remark-gemoji'/* for shortcode emoji support */
import rehypePixelated from './src/plugins/rehype-pixelated'/* Custom plugin to handle pixelated images */
import mermaid from 'astro-mermaid'
import moonarc from 'moonarc';

import icon from 'astro-icon';

// https://astro.build/config
export default defineConfig({
  site: siteConfig.site,
  trailingSlash: 'ignore',
  prefetch: true,
  // Astro 7 defaults to 'jsx' whitespace stripping, which drops spaces between inline elements in the theme components
  compressHTML: true,
  markdown: {
    // Keep the remark/rehype pipeline, Astro 7 defaults to Sätteri which can't run these plugins
    processor: unified({
      remarkPlugins: [
        [remarkDescription, { maxChars: 200 }],
        remarkReadingTime,
        remarkDirective,
        remarkGithubCard,
        remarkAdmonitions,
        [remarkCharacterDialogue, { characters: siteConfig.characters }],
        remarkUnknownDirectives,
        remarkMath,
        remarkGemoji,
        remarkCustomHeaderId,
      ],
      rehypePlugins: [
        rehypeHeadingIds,
        [rehypeAutolinkHeadings, { behavior: 'wrap' }],
        rehypeTitleFigure,
        [
          rehypeExternalLinks,
          {
            rel: ['noreferrer', 'noopener'],
            target: '_blank',
          },
        ],
        rehypeUnwrapImages,
        rehypePixelated,
        rehypeKatex,
      ],
    }),
  },
  image: {
    responsiveStyles: true,
  },
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [sitemap(), // Must come after expressive-code integration
  codeblocks({
    codeTabs: {},
    expandable: { lines: 12, auto: 30 },
    expressiveCode: {
      themes: siteConfig.themes.include,
      useDarkModeMediaQuery: true,
    }
  }), mermaid({
    theme: 'neutral',
    autoTheme: true,
    mermaidConfig: {
      flowchart: {
      },
    },
  }), mdx(), moonarc(), icon()],
  experimental: {
    contentIntellisense: true,
  },
})