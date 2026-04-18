import React, { useState } from 'react';
import { Button } from '@material-tailwind/react';

const CustomButton = ({ onClick, color, children,disabled }) => {

  const handleClick = (e) => {
    e.preventDefault();

    if (onClick) {
      onClick();
    }
  };

  return (
    <Button
      color={color}
      onClick={handleClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
};

export default CustomButton;