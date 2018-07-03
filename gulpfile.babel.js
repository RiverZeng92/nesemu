'use strict'

import gulp from 'gulp'
const browserSync = require('browser-sync').create()

// TypeScript
import clone from 'clone'
import webpack from 'webpack'
import webpackStream from 'webpack-stream'
import webpackConfig from './webpack.config.babel'
import tslint from 'gulp-tslint'

// HTML
import ejs from 'gulp-ejs'
import htmlmin from 'gulp-htmlmin'

// SASS
import sass from 'gulp-sass'
import cssnano from 'gulp-cssnano'

// Unit test
const jest = require('gulp-jest').default

import plumber from 'gulp-plumber'
import del from 'del'

const ROOT_DIR = `${__dirname}/.`
const RES_DIR = `${ROOT_DIR}/res`
const DEST_DIR = `${ROOT_DIR}/public`
const ASSETS_DIR = `${DEST_DIR}/assets`
const SRC_TS_DIR = `${ROOT_DIR}/src`
const SRC_TS_FILES = `${SRC_TS_DIR}/**/*.ts`
const SRC_HTML_DIR = `${ROOT_DIR}/src`
const SRC_HTML_FILES = `${SRC_HTML_DIR}/*.html`  // */
const SRC_SASS_FILES = `${ROOT_DIR}/src/**/*.scss`
const SRC_TEST_DIR = `${ROOT_DIR}/test`
const SRC_TEST_FILES = `${SRC_TEST_DIR}/**/*.spec.ts`
const RELEASE_DIR = `${ROOT_DIR}/release`
const RELEASE_ASSETS_DIR = `${RELEASE_DIR}/assets`

function convertHtml(buildTarget, dest) {
  return gulp.src([SRC_HTML_FILES,
            '!' + SRC_HTML_DIR + '/**/_*.html'])
    .pipe(plumber())
    .pipe(ejs({buildTarget: buildTarget}))
    .pipe(htmlmin({
      collapseWhitespace: true,
      removeComments: true,
      minifyCSS: true,
      minifyJS: true,
      removeAttributeQuotes: true,
    }))
    .pipe(gulp.dest(dest))
    .pipe(browserSync.reload({stream: true}))
}

function lint(glob) {
  return gulp.src(glob)
    .pipe(tslint({
      configuration: 'tslint.json',
      formatter: 'prose',
    }))
    .pipe(tslint.report({
      emitError: false,
    }))
}

function buildWhenModified(glob, buildFunc) {
  gulp.watch(glob, (obj) => {
    if (obj.type === 'changed')
      buildFunc(obj.path)
  })
}

gulp.task('default', ['build', 'server', 'watch'])

gulp.task('watch', ['watch-html', 'watch-ts', 'watch-sass',
                    'watch-lint', 'watch-test'])

gulp.task('build', ['html', 'ts', 'sass', 'copy-res'])

gulp.task('html', () => {
  return convertHtml('debug', DEST_DIR)
})

gulp.task('watch-html', [], () => {
  gulp.watch(SRC_HTML_FILES, ['html'])
})

gulp.task('ts', () => {
  const config = clone(webpackConfig)
  config.mode = 'development'
  config.devtool = '#cheap-module-source-map'
  return gulp.src([`${SRC_TS_DIR}/main.ts`,
                   `${SRC_TS_DIR}/lib.ts`])
    .pipe(plumber())
    .pipe(webpackStream(config, webpack))
    .pipe(gulp.dest(ASSETS_DIR))
})

gulp.task('watch-ts', [], () => {
  const config = clone(webpackConfig)
  config.mode = 'development'
  config.watch = true
  config.devtool = '#cheap-module-source-map'
  gulp.src(SRC_TS_FILES)
    .pipe(plumber())
    .pipe(webpackStream(config, webpack))
    .pipe(gulp.dest(ASSETS_DIR))
    .pipe(browserSync.reload({stream: true}))
})

gulp.task('sass', () => {
  return gulp.src(SRC_SASS_FILES)
    .pipe(plumber())
    .pipe(sass())
    .pipe(cssnano())
    .pipe(gulp.dest(ASSETS_DIR))
    .pipe(browserSync.reload({stream: true}))
})

gulp.task('watch-sass', [], () => {
  gulp.watch(SRC_SASS_FILES, ['sass'])
})

gulp.task('lint', () => {
  return lint([`${SRC_TS_DIR}/**/*.ts`,
               `!${SRC_TS_DIR}/lib.ts`])
})

gulp.task('watch-lint', [], () => {
  buildWhenModified([`${SRC_TS_DIR}/**/*.ts`,
                     `!${SRC_TS_DIR}/lib.ts`],
                    lint)
})

gulp.task('copy-res', () => {
  return gulp.src([`${RES_DIR}/**/*`],
                  {base: RES_DIR})
    .pipe(gulp.dest(DEST_DIR))
})

gulp.task('server', () => {
  browserSync.init({
    server: {
      baseDir: DEST_DIR,
    },
  })
})

// Unit test.
gulp.task('test', (done) => {
  return gulp.src(SRC_TEST_DIR)
    .pipe(jest({
      "transform": {
        "^.+\\.tsx?$": "ts-jest",
      },
      "testRegex": "(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$",
      "moduleFileExtensions": [
        "ts",
        "tsx",
        "js",
        "jsx",
        "json",
        "node",
      ],
    }))
})
gulp.task('watch-test', () => {
  gulp.watch(
    [SRC_TS_FILES,
     SRC_TEST_FILES],
    ['test'])
})

gulp.task('clean', del.bind(null, [
  DEST_DIR,
]))

gulp.task('release', ['build'], () => {
  // Copy resources.
  gulp.src([`${DEST_DIR}/**/*.*`,
            `!${DEST_DIR}/index.html`,
            `!${DEST_DIR}/**/*.map`,
           ],
           {base: DEST_DIR})
    .pipe(gulp.dest(RELEASE_DIR))

  // Build HTML for release.
  convertHtml('release', RELEASE_DIR)

  // Concatenate ts into single 'assets/main.js' file.
  const config = clone(webpackConfig)
  //config.plugins = config.plugins || []
  //config.plugins.push(new webpack.optimize.UglifyJsPlugin())
  gulp.src(`${SRC_TS_DIR}/main.js`)
    .pipe(plumber())
    .pipe(webpackStream(config, webpack))
    .pipe(gulp.dest(RELEASE_ASSETS_DIR))
})
