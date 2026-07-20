module.exports = {
    collectCoverageFrom: [
        'src/checks/*.js',
        'src/validator.js',
    ],
    coverageReporters: ['text', 'lcov']
};
