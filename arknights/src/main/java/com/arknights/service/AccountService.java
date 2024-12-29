package com.arknights.service;

import org.springframework.stereotype.Service;

import com.arknights.pojo.User;

@Service
public interface AccountService {
  public User login(User user);

  public Boolean register(User user);
}
