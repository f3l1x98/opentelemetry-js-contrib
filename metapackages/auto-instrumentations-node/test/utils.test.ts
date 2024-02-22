/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { diag } from '@opentelemetry/api';
import { HttpInstrumentationConfig } from '@opentelemetry/instrumentation-http';
import * as assert from 'assert';
import * as sinon from 'sinon';
import { getNodeAutoInstrumentations } from '../src';
import {
  isInstrumentationEnabledFromEnv,
  getResourceDetectorsFromEnv,
  extractInstrumentationEnvNameFromPackageName,
} from '../src/utils';

describe('utils', () => {
  describe('getNodeAutoInstrumentations', () => {
    it('should include all installed instrumentations', () => {
      const instrumentations = getNodeAutoInstrumentations();
      const installedInstrumentations = Object.keys(
        require('../package.json').dependencies
      ).filter(depName => {
        return depName.startsWith('@opentelemetry/instrumentation-');
      });

      assert.deepStrictEqual(
        new Set(instrumentations.map(i => i.instrumentationName)),
        new Set(installedInstrumentations)
      );
    });

    it('should use user config', () => {
      function applyCustomAttributesOnSpan() {}

      const instrumentations = getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-http': {
          applyCustomAttributesOnSpan,
        },
      });
      const instrumentation = instrumentations.find(
        instr =>
          instr.instrumentationName === '@opentelemetry/instrumentation-http'
      ) as any;
      const configHttp = instrumentation._config as HttpInstrumentationConfig;

      assert.strictEqual(
        configHttp.applyCustomAttributesOnSpan,
        applyCustomAttributesOnSpan
      );
    });

    it('should not return disabled instrumentation', () => {
      const instrumentations = getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-grpc': {
          enabled: false,
        },
      });
      const instrumentation = instrumentations.find(
        instr =>
          instr.instrumentationName === '@opentelemetry/instrumentation-grpc'
      );
      assert.strictEqual(instrumentation, undefined);
    });

    it('should show error for none existing instrumentation', () => {
      const spy = sinon.stub(diag, 'error');
      const name = '@opentelemetry/instrumentation-http2';
      const instrumentations = getNodeAutoInstrumentations({
        // @ts-expect-error verify that wrong name works
        [name]: {
          enabled: false,
        },
      });
      const instrumentation = instrumentations.find(
        instr => instr.instrumentationName === name
      );
      assert.strictEqual(instrumentation, undefined);

      assert.strictEqual(
        spy.args[0][0],
        `Provided instrumentation name "${name}" not found`
      );

      spy.restore();
    });

    it('should prioritize env enabled', () => {
      process.env.OTEL_INSTRUMENTATION_GRPC_ENABLED = 'false';

      const instrumentations = getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-grpc': {
          enabled: true,
        },
      });
      const instrumentation = instrumentations.find(
        instr =>
          instr.instrumentationName === '@opentelemetry/instrumentation-grpc'
      );
      assert.strictEqual(instrumentation, undefined);

      delete process.env.OTEL_INSTRUMENTATION_GRPC_ENABLED;
    });
  });

  describe('isInstrumentationEnabledFromEnv', () => {
    it('should return true if env is set to true', () => {
      process.env.OTEL_INSTRUMENTATION_FS_ENABLED = 'true';

      const enabled = isInstrumentationEnabledFromEnv(
        '@opentelemetry/instrumentation-fs'
      );

      assert.equal(enabled, true);

      delete process.env.OTEL_INSTRUMENTATION_FS_ENABLED;
    });

    it('should return false if env is set to false', () => {
      process.env.OTEL_INSTRUMENTATION_FS_ENABLED = 'false';

      const enabled = isInstrumentationEnabledFromEnv(
        '@opentelemetry/instrumentation-fs'
      );

      assert.equal(enabled, false);

      delete process.env.OTEL_INSTRUMENTATION_FS_ENABLED;
    });

    it('should return undefined if env not set', () => {
      const enabled = isInstrumentationEnabledFromEnv(
        '@opentelemetry/instrumentation-fs'
      );

      assert.equal(enabled, undefined);
    });

    it('should return undefined if instrumentation name extraction failed', () => {
      const enabled = isInstrumentationEnabledFromEnv('fs');

      assert.equal(enabled, undefined);
    });
  });

  describe('extractInstrumentationEnvNameFromPackageName', () => {
    it('should return non empty string on valid instrumentation package name', () => {
      const instrumentationEnvName =
        extractInstrumentationEnvNameFromPackageName(
          '@opentelemetry/instrumentation-fs'
        );

      assert.equal(instrumentationEnvName, 'FS');
    });

    it('should replace dash with underscore', () => {
      const instrumentationEnvName =
        extractInstrumentationEnvNameFromPackageName(
          '@opentelemetry/instrumentation-aws-sdk'
        );

      assert.equal(instrumentationEnvName, 'AWS_SDK');
    });
  });

  describe('getResourceDetectorsFromEnv', () => {
    it('should return all resource detectors by default', () => {
      assert.equal(getResourceDetectorsFromEnv().length, 12);
    });

    it('should return all resource detectors when OTEL_NODE_RESOURCE_DETECTORS contains "all"', () => {
      process.env.OTEL_NODE_RESOURCE_DETECTORS = 'all';

      assert.equal(getResourceDetectorsFromEnv().length, 12);

      delete process.env.OTEL_NODE_RESOURCE_DETECTORS;
    });

    it('should return specific resource detectors depending on OTEL_NODE_RESOURCE_DETECTORS', () => {
      process.env.OTEL_NODE_RESOURCE_DETECTORS = 'env,host';

      const resourceDetectors = getResourceDetectorsFromEnv();

      assert.equal(resourceDetectors.length, 2);
      assert.equal(resourceDetectors[0].constructor.name, 'EnvDetectorSync');
      assert.equal(resourceDetectors[1].constructor.name, 'HostDetectorSync');

      delete process.env.OTEL_NODE_RESOURCE_DETECTORS;
    });

    it('should return no resource detectors when OTEL_NODE_RESOURCE_DETECTORS contains "none" or a typo', () => {
      const spy = sinon.stub(diag, 'error');
      process.env.OTEL_NODE_RESOURCE_DETECTORS = 'none';

      assert.equal(getResourceDetectorsFromEnv().length, 0);

      assert.strictEqual(spy.callCount, 0);

      process.env.OTEL_NODE_RESOURCE_DETECTORS = 'test';

      assert.equal(getResourceDetectorsFromEnv().length, 0);

      assert.strictEqual(
        spy.args[0][0],
        'Invalid resource detector "test" specified in the environment variable OTEL_NODE_RESOURCE_DETECTORS'
      );

      spy.restore();
      delete process.env.OTEL_NODE_RESOURCE_DETECTORS;
    });
  });
});
