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

type Options[T any] []Option[T]

func (o Options[T]) Apply(v T) error {
	for _, opt := range o {
		err := opt.Apply(v)
		if err != nil {
			return err
		}
	}
	return nil
}

type Option[T any] func(T) error

func (o Option[T]) Apply(v T) error {
	return o(v)
}
