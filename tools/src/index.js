/*
 * Copyright (c) by the Society of Motion Picture and Television Engineers
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 * list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 * this list of conditions and the following disclaimer in the documentation and/or
 * other materials provided with the distribution.
 */

/*
 * Public library surface for the st2138-a tools package.
 *
 * For backwards compatibility the Validator class remains the default export so
 * existing consumers using `require('smpte-st2138-a-tools')` continue to work.
 * It is also available as a named export.
 */

'use strict';

const Validator = require('./validator');

module.exports = Validator;
module.exports.Validator = Validator;
