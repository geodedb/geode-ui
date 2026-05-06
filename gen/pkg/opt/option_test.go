// Copyright (c) 2024 by SPYDER.
//
// This software is proprietary information of SPYDER.
// Unauthorized use, copying, modification, distribution, and/or
// disclosure is strictly prohibited, except as provided under the terms
// of the commercial license agreement you have entered into with
// SPYDER.
//
// For more details, see the LICENSE file in the root directory of this
// source code repository or contact SPYDER at info@spyder.org.

package opt

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestConfig represents a simple configuration object for testing
type TestConfig struct {
	Name    string
	Port    int
	Enabled bool
	Tags    []string
}

// Option builders for TestConfig
func WithName(name string) Option[*TestConfig] {
	return func(config *TestConfig) error {
		if name == "" {
			return errors.New("name cannot be empty")
		}
		config.Name = name
		return nil
	}
}

func WithPort(port int) Option[*TestConfig] {
	return func(config *TestConfig) error {
		if port <= 0 || port > 65535 {
			return errors.New("port must be between 1 and 65535")
		}
		config.Port = port
		return nil
	}
}

func WithEnabled(enabled bool) Option[*TestConfig] {
	return func(config *TestConfig) error {
		config.Enabled = enabled
		return nil
	}
}

func WithTags(tags ...string) Option[*TestConfig] {
	return func(config *TestConfig) error {
		config.Tags = append(config.Tags, tags...)
		return nil
	}
}

func WithErrorOption() Option[*TestConfig] {
	return func(_ *TestConfig) error {
		return errors.New("intentional error for testing")
	}
}

func TestOption_Apply_Success(t *testing.T) {
	config := &TestConfig{}
	opt := WithName("test-service")

	err := opt.Apply(config)

	assert.NoError(t, err)
	assert.Equal(t, "test-service", config.Name)
}

func TestOption_Apply_Error(t *testing.T) {
	config := &TestConfig{}
	opt := WithName("")

	err := opt.Apply(config)

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "name cannot be empty")
}

func TestOptions_Apply_Success(t *testing.T) {
	config := &TestConfig{}
	opts := Options[*TestConfig]{
		WithName("web-server"),
		WithPort(8080),
		WithEnabled(true),
		WithTags("production", "api"),
	}

	err := opts.Apply(config)

	require.NoError(t, err)
	assert.Equal(t, "web-server", config.Name)
	assert.Equal(t, 8080, config.Port)
	assert.True(t, config.Enabled)
	assert.Equal(t, []string{"production", "api"}, config.Tags)
}

func TestOptions_Apply_EmptyOptions(t *testing.T) {
	config := &TestConfig{}
	opts := Options[*TestConfig]{}

	err := opts.Apply(config)

	assert.NoError(t, err)
	// Config should remain unchanged
	assert.Equal(t, &TestConfig{}, config)
}

func TestOptions_Apply_ErrorInMiddle(t *testing.T) {
	config := &TestConfig{}
	opts := Options[*TestConfig]{
		WithName("test-service"),
		WithPort(80),
		WithPort(70000),   // This should fail - port too high
		WithEnabled(true), // This should not be reached
	}

	err := opts.Apply(config)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "port must be between 1 and 65535")

	// Verify partial application - first two options should have been applied
	assert.Equal(t, "test-service", config.Name)
	assert.Equal(t, 80, config.Port)
	assert.False(t, config.Enabled) // Should remain false since error occurred before this
}

func TestOptions_Apply_ErrorFirst(t *testing.T) {
	config := &TestConfig{}
	opts := Options[*TestConfig]{
		WithErrorOption(),
		WithName("test-service"),
		WithPort(8080),
	}

	err := opts.Apply(config)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "intentional error for testing")

	// Config should remain unchanged since first option failed
	assert.Equal(t, &TestConfig{}, config)
}

func TestOptions_Apply_MultipleErrors(t *testing.T) {
	config := &TestConfig{}
	opts := Options[*TestConfig]{
		WithName("valid-name"),
		WithPort(-1),    // Invalid port
		WithPort(70000), // This won't be reached
	}

	err := opts.Apply(config)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "port must be between 1 and 65535")

	// Only the first option should have been applied
	assert.Equal(t, "valid-name", config.Name)
	assert.Equal(t, 0, config.Port) // Should remain 0 since port option failed
}

func TestOption_FunctionalChaining(t *testing.T) {
	// Test that options can be applied in sequence
	config := &TestConfig{}

	// Apply options one by one
	err := WithName("service-1").Apply(config)
	require.NoError(t, err)

	err = WithPort(3000).Apply(config)
	require.NoError(t, err)

	err = WithEnabled(true).Apply(config)
	require.NoError(t, err)

	err = WithTags("dev", "experimental").Apply(config)
	require.NoError(t, err)

	// Verify final state
	assert.Equal(t, "service-1", config.Name)
	assert.Equal(t, 3000, config.Port)
	assert.True(t, config.Enabled)
	assert.Equal(t, []string{"dev", "experimental"}, config.Tags)
}

// Test with different types to ensure generics work correctly
type SimpleStruct struct {
	Value string
}

func WithValue(value string) Option[*SimpleStruct] {
	return func(s *SimpleStruct) error {
		s.Value = value
		return nil
	}
}

func TestOptions_WithDifferentTypes(t *testing.T) {
	simple := &SimpleStruct{}
	opts := Options[*SimpleStruct]{
		WithValue("hello world"),
	}

	err := opts.Apply(simple)

	assert.NoError(t, err)
	assert.Equal(t, "hello world", simple.Value)
}

// Test with value types (not pointers)
type ValueStruct struct {
	Data int
}

func WithData(_ int) Option[ValueStruct] {
	return func(_ ValueStruct) error {
		return nil
	}
}

func TestOptions_WithValueTypes(t *testing.T) {
	value := ValueStruct{}
	opts := Options[ValueStruct]{
		WithData(42),
	}

	err := opts.Apply(value)

	assert.NoError(t, err)
	// Note: value.Data will still be 0 because we passed by value
	// This demonstrates why pointer types are typically used with options
	assert.Equal(t, 0, value.Data)
}
