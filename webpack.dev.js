const path = require('path')
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin
const CircularDependencyPlugin = require('circular-dependency-plugin')

const ASSET_PATH = process.env.ASSET_PATH || '/dev/'
const ROOT_PATH = process.env.ROOT_PATH || '/'

module.exports = {
    mode: 'development',
    entry: {
        'emg-module': { import: path.join(__dirname, 'src', 'index.ts') },
    },
    module: {
        rules: [
        {
            test: /\.tsx?$/,
            use: 'ts-loader',
            exclude: /node_modules/,
        },
        ],
    },
    devServer: {
        allowedHosts: 'all',
        client: {
            webSocketURL: 'auto://0.0.0.0:0' + ROOT_PATH + '/ws',
        },
        compress: true,
        headers: {
            // Cross-origin isolation is needed for shared memory buffers.
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        },
        historyApiFallback: true,
        port: 8081,
        static: {
            directory: path.join(__dirname, 'umd'),
            publicPath: ROOT_PATH,
        },
    },
    output: {
        path: path.resolve(__dirname, 'umd', 'dev'),
        publicPath: ASSET_PATH,
        filename: '[name].js',
        chunkFilename: '[name].js?v=[contenthash]',
        library: 'EmgModule',
        libraryTarget: 'umd'
    },
    plugins: [
        new BundleAnalyzerPlugin(),
        new CircularDependencyPlugin({
            // exclude detection of files based on a RegExp
            exclude: /a\.js|node_modules/,
            // include specific files based on a RegExp
            include: /src/,
            // add errors to webpack instead of warnings
            failOnError: true,
            // allow import cycles that include an asynchronous import,
            // e.g. via import(/* webpackMode: "weak" */ './file.js')
            allowAsyncCycles: false,
            // set the current working directory for displaying module paths
            cwd: process.cwd(),
        })
    ],
    resolve: {
        extensions: ['.ts', '.js', '.json'],
        alias: {
            '#root': path.resolve(__dirname, './'),
            '#components': path.resolve(__dirname, 'src', 'components'),
            '#config': path.resolve(__dirname, 'src', 'config'),
            '#events': path.resolve(__dirname, 'src', 'events'),
            '#loader': path.resolve(__dirname, 'src', 'loader'),
            '#runtime': path.resolve(__dirname, 'src', 'runtime'),
            '#service': path.resolve(__dirname, 'src', 'service'),
            '#types': path.resolve(__dirname, 'src', 'types'),
        },
        symlinks: false
    },
    stats: {
        errorDetails: true
    },
}
